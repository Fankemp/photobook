package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"

	"photobook/internal/formats"
	"photobook/internal/orders"
	"photobook/internal/pages"
)

type printResponse struct {
	Format    formats.Format    `json:"format"`
	Cover     pages.Page        `json:"cover"`
	Pages     []pages.Page      `json:"pages"`
	BackCover pages.Page        `json:"backCover"`
	Images    map[string]string `json:"images"` // id фото → ссылка на оригинал
}

// printData — данные для печатной страницы /print/<id заявки>. Её открывает
// только сервис рендера по подписанной ссылке (см. render.Signer): здесь
// отдаются оригиналы фото, которые клиенту не показываем.
func (a *API) printData(w http.ResponseWriter, r *http.Request) {
	orderID := r.PathValue("order")
	q := r.URL.Query()
	if uuid.Validate(orderID) != nil || !a.Signer.Verify(orderID, q.Get("exp"), q.Get("sig"), time.Now()) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	bookID, err := a.Orders.BookOf(r.Context(), orderID)
	if errors.Is(err, orders.ErrNotFound) {
		writeError(w, http.StatusNotFound, "order_not_found")
		return
	}
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	b, err := a.Books.GetByID(r.Context(), bookID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	f, err := a.Formats.Get(r.Context(), b.FormatID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	uploaded, err := a.Assets.ListUploaded(r.Context(), b.ID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	images := map[string]string{}
	for id, as := range uploaded {
		url, err := a.Assets.OriginalURLForPrint(r.Context(), as)
		if err != nil {
			a.internalError(w, r, err)
			return
		}
		images[id] = url
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, printResponse{Format: f, Cover: b.Cover, Pages: b.Pages, BackCover: b.BackCover, Images: images})
}
