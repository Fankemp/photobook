package orders_test

// Окно правок после заявки и снимки заказа — на настоящей базе (блокировки,
// триггер неизменности снимков). Нужна пустая тестовая база: make test-db
// создаёт её в Postgres из docker compose и передаёт TEST_DATABASE_URL.
// Без переменной тесты пропускаются (make test работает и без Docker).

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"photobook/internal/books"
	"photobook/internal/db"
	"photobook/internal/orders"
	"photobook/internal/pages"
)

func testDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set (make test-db)")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	m, err := db.NewMigrator(pool)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Up(ctx); err != nil {
		t.Fatal(err)
	}
	return pool
}

func textPage(id, text string) pages.Page {
	return pages.Page{ID: id, Background: "#ffffff", Elements: []pages.Element{
		{Type: pages.Text, ID: "t1", X: 10, Y: 10, W: 80, H: 10, Text: &text, Font: "lora", Size: 14, Align: "center"},
	}}
}

// newOrder — книга и заявка по ней (с галочкой подтверждения).
func newOrder(t *testing.T, pool *pgxpool.Pool) (*books.Store, *orders.Service, books.Book, orders.Order) {
	t.Helper()
	ctx := context.Background()
	bs := books.NewStore(pool)
	var formatID string
	if err := pool.QueryRow(ctx, `SELECT id FROM formats LIMIT 1`).Scan(&formatID); err != nil {
		t.Fatal(err)
	}
	b, err := bs.Create(ctx, books.Book{Token: randToken(), TemplateID: "travel-minimal", FormatID: formatID, SchemaVersion: 1,
		Cover: textPage("cover", "Наше лето"), Pages: []pages.Page{textPage("p1", "Море"), textPage("p2", "Горы")},
		BackCover: textPage("back", "")})
	if err != nil {
		t.Fatal(err)
	}
	svc := orders.NewService(pool, 0)
	in := orders.Input{Name: "Тест", Phone: "+77001234567", Address: "Алматы, Абая 1",
		WantedDate: time.Now().In(orders.Almaty).Format("2006-01-02"), Version: b.Version, Confirmed: true}
	o, err := svc.Create(ctx, b.ID, 0, in)
	if err != nil {
		t.Fatal(err)
	}
	return bs, svc, b, o
}

var tokenSeq = time.Now().UnixNano()

func randToken() string {
	tokenSeq++
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
	out := make([]byte, 26)
	n := tokenSeq
	for i := range out {
		out[i] = alphabet[n%32]
		n /= 32
		if n == 0 {
			n = tokenSeq + int64(i)*7919
		}
	}
	return string(out)
}

func TestNoOrderWithoutConfirmationDB(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	bs := books.NewStore(pool)
	var formatID string
	if err := pool.QueryRow(ctx, `SELECT id FROM formats LIMIT 1`).Scan(&formatID); err != nil {
		t.Fatal(err)
	}
	b, err := bs.Create(ctx, books.Book{Token: randToken(), TemplateID: "travel-minimal", FormatID: formatID, SchemaVersion: 1,
		Cover: textPage("cover", ""), Pages: []pages.Page{}, BackCover: textPage("back", "")})
	if err != nil {
		t.Fatal(err)
	}
	svc := orders.NewService(pool, 0)
	_, err = svc.Create(ctx, b.ID, 0, orders.Input{Name: "Тест", Phone: "+77001234567", Address: "Алматы, Абая 1",
		WantedDate: "2030-01-01", Version: b.Version}) // Confirmed: false — галочки нет
	var ve orders.ValidationError
	if !errors.As(err, &ve) || ve.Code != "not_confirmed" {
		t.Fatalf("order without the checkbox: err = %v, want not_confirmed", err)
	}
	if o, _ := svc.ActiveForBook(ctx, b.ID); o != nil {
		t.Fatal("order was created without the confirmation checkbox")
	}
}

func TestEditWindowDB(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	bs, svc, b, o := newOrder(t, pool)

	// Заказ new: клиент правит книгу — сохраняется, правка отмечена в заказе.
	b.Pages[0] = textPage("p1", "Море, 2026")
	v, _, err := bs.SavePages(ctx, b.ID, b.Version, b.Cover, b.Pages, b.BackCover)
	if err != nil {
		t.Fatalf("save while the order is new: %v", err)
	}

	// Клиент затих — событие в истории, сообщение в Telegram, пересборка PDF.
	for {
		did, err := svc.SettleChanges(ctx, 0)
		if err != nil {
			t.Fatal(err)
		}
		if !did {
			break
		}
	}
	var events, notices int
	var reason string
	var rendered *time.Time
	if err := pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM order_events WHERE order_id = o.id AND note LIKE 'Клиент изменил книгу%'),
		       (SELECT count(*) FROM order_notices WHERE order_id = o.id AND kind = 'book_changed' AND book_version = $2),
		       o.render_reason, o.rendered_at
		FROM orders o WHERE o.id = $1`, o.ID, v).Scan(&events, &notices, &reason, &rendered); err != nil {
		t.Fatal(err)
	}
	if events != 1 || notices != 1 || reason != "client_change" || rendered != nil {
		t.Fatalf("after a client change: events=%d notices=%d reason=%s rendered=%v; want 1, 1, client_change, rebuild queued",
			events, notices, reason, rendered)
	}

	// PDF ещё не собран из новой версии — в печать нельзя.
	if err := svc.ChangeStatus(ctx, o.Number, orders.StatusPrinting, ""); !errors.Is(err, orders.ErrPDFNotCurrent) {
		t.Fatalf("send to print with a stale PDF: err = %v, want ErrPDFNotCurrent", err)
	}
	// Сборка: новый снимок (версия 2, правка клиента) с текущей книгой.
	sn, err := svc.VersionForRender(ctx, o.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sn.Number != 2 || sn.Reason != "client_change" || sn.BookVersion != v || *sn.Pages[0].Elements[0].Text != "Море, 2026" {
		t.Fatalf("snapshot for rebuild: v%d %s book v%d; want v2 client_change book v%d with the new text", sn.Number, sn.Reason, sn.BookVersion, v)
	}
	if err := svc.SaveRenderedPDF(ctx, o.ID, sn.Version, orders.PDF{Book: "orders/test/v2/book.pdf"}); err != nil {
		t.Fatal(err)
	}
	if err := svc.ChangeStatus(ctx, o.Number, orders.StatusPrinting, "Отправлено в печать"); err != nil {
		t.Fatalf("send to print with a current PDF: %v", err)
	}

	// В печати: правка отклоняется, данные книги не тронуты.
	changed := b.Pages
	changed[1] = textPage("p2", "Горы — поздно")
	if _, _, err := bs.SavePages(ctx, b.ID, v, b.Cover, changed, b.BackCover); !errors.Is(err, books.ErrLocked) {
		t.Fatalf("save while printing: err = %v, want ErrLocked", err)
	}
	after, err := bs.GetByID(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Version != v || *after.Pages[1].Elements[0].Text != "Горы" {
		t.Fatalf("locked book was changed: version %d (want %d), text %q", after.Version, v, *after.Pages[1].Elements[0].Text)
	}
	if locked, err := bs.IsLocked(ctx, b.ID); err != nil || !locked {
		t.Fatalf("IsLocked while printing = %v, %v (uploads must be closed too)", locked, err)
	}
	// И дальше по статусам — тоже закрыта.
	for _, st := range []string{"delivery", "done"} {
		if err := svc.ChangeStatus(ctx, o.Number, st, ""); err != nil {
			t.Fatal(err)
		}
		if _, _, err := bs.SavePages(ctx, b.ID, v, b.Cover, changed, b.BackCover); !errors.Is(err, books.ErrLocked) {
			t.Fatalf("save while %s: err = %v, want ErrLocked", st, err)
		}
	}
}

func TestSnapshotsAreImmutableDB(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	bs, svc, b, o := newOrder(t, pool)

	// Снимок версии 1 нельзя изменить или удалить — только новая версия.
	if _, err := pool.Exec(ctx, `UPDATE order_versions SET pages = '[]' WHERE order_id = $1`, o.ID); err == nil {
		t.Fatal("snapshot pages were overwritten")
	}
	if _, err := pool.Exec(ctx, `DELETE FROM order_versions WHERE order_id = $1`, o.ID); err == nil {
		t.Fatal("snapshot was deleted")
	}
	v1, err := svc.VersionForRender(ctx, o.ID)
	if err != nil {
		t.Fatal(err)
	}
	if v1.Number != 1 || v1.Reason != "order" || v1.ConfirmedAt == nil {
		t.Fatalf("first snapshot: v%d %s confirmed=%v; want v1 order with the confirmation", v1.Number, v1.Reason, v1.ConfirmedAt)
	}
	if err := svc.SaveRenderedPDF(ctx, o.ID, v1.Version, orders.PDF{Book: "orders/test/v1/book.pdf"}); err != nil {
		t.Fatal(err)
	}
	// PDF версии записывается один раз.
	if err := svc.SaveRenderedPDF(ctx, o.ID, v1.Version, orders.PDF{Book: "orders/test/other.pdf"}); err == nil {
		t.Fatal("PDF of a rendered version was overwritten")
	}

	// Правка и пересборка — новая версия; версия 1 осталась как была.
	b.Cover = textPage("cover", "Наше лето — исправлено")
	if _, _, err := bs.SavePages(ctx, b.ID, b.Version, b.Cover, b.Pages, b.BackCover); err != nil {
		t.Fatal(err)
	}
	if err := svc.ResetRender(ctx, o.Number); err != nil {
		t.Fatal(err)
	}
	v2, err := svc.VersionForRender(ctx, o.ID)
	if err != nil {
		t.Fatal(err)
	}
	if v2.Number != 2 || *v2.Cover.Elements[0].Text != "Наше лето — исправлено" {
		t.Fatalf("rebuild must make version 2 with the new text, got v%d", v2.Number)
	}
	again, err := svc.SnapshotOf(ctx, o.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if *again.Cover.Elements[0].Text != "Наше лето" || again.BookPDFKey != "orders/test/v1/book.pdf" {
		t.Fatalf("version 1 changed: text %q, pdf %q", *again.Cover.Elements[0].Text, again.BookPDFKey)
	}
	list, err := svc.Versions(ctx, o.ID)
	if err != nil || len(list) != 2 || list[0].Number != 2 || list[1].Number != 1 {
		t.Fatalf("versions history: %+v, %v", list, err)
	}
}
