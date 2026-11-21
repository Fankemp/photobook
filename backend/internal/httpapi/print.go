package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"photobook/internal/formats"
	"photobook/internal/orders"
	"photobook/internal/pages"
	"photobook/internal/render"
)

type printResponse struct {
	Format    formats.Format    `json:"format"`
	Cover     pages.Page        `json:"cover"`
	Pages     []pages.Page      `json:"pages"`
	BackCover pages.Page        `json:"backCover"`
	Images    map[string]string `json:"images"` // id фото → ссылка на оригинал
}

// printData — данные для печатной страницы /print/<id заявки>?v=<версия>. Её открывает
// только сервис рендера по подписанной ссылке (см. render.Signer): здесь
// отдаются оригиналы фото, которые клиенту не показываем.
func (a *API) printData(w http.ResponseWriter, r *http.Request) {
	orderID := r.PathValue("order")
	q := r.URL.Query()
	version, verr := strconv.Atoi(q.Get("v"))
	if uuid.Validate(orderID) != nil || verr != nil ||
		!a.Signer.Verify(render.PrintSubject(orderID, version), q.Get("exp"), q.Get("sig"), time.Now()) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	// Печатаем снимок заказа этой версии — ровно то, что было в книге при снимке.
	sn, err := a.Orders.SnapshotOf(r.Context(), orderID, version)
	if errors.Is(err, orders.ErrNotFound) {
		writeError(w, http.StatusNotFound, "order_not_found")
		return
	}
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	uploaded, err := a.Assets.ListUploaded(r.Context(), sn.BookID)
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
	writeJSON(w, http.StatusOK, printResponse{Format: sn.Format, Cover: sn.Cover, Pages: sn.Pages, BackCover: sn.BackCover, Images: images})
}
