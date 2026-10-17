package httpapi

import (
	"errors"
	"net/http"
	"time"

	"photobook/internal/orders"
)

type orderInfoResponse struct {
	Order         *orders.Order `json:"order"`         // null — заявки ещё нет
	MinWantedDate string        `json:"minWantedDate"` // самая ранняя дата для формы
	PriceKZT      int           `json:"priceKzt"`
}

// getOrder — для страницы заявки: либо заявка уже есть (показываем статус),
// либо данные для формы.
func (a *API) getOrder(w http.ResponseWriter, r *http.Request) {
	b, ok := a.bookFromPath(w, r)
	if !ok {
		return
	}
	f, err := a.Formats.Get(r.Context(), b.FormatID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	o, err := a.Orders.ActiveForBook(r.Context(), b.ID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, orderInfoResponse{
		Order:         o,
		MinWantedDate: a.Orders.MinWantedDate(time.Now()).Format("2006-01-02"),
		PriceKZT:      f.PriceKZT,
	})
}

// createOrder — заявка с формы. После неё книга закрыта для изменений,
// а команде уходит сообщение в Telegram (в фоне, через очередь).
func (a *API) createOrder(w http.ResponseWriter, r *http.Request) {
	b, ok := a.bookFromPath(w, r)
	if !ok {
		return
	}
	var in orders.Input
	if err := readJSON(w, r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	in, err := a.Orders.Validate(in, time.Now())
	var ve orders.ValidationError
	if errors.As(err, &ve) {
		writeError(w, http.StatusBadRequest, ve.Code)
		return
	}
	f, err := a.Formats.Get(r.Context(), b.FormatID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	o, err := a.Orders.Create(r.Context(), b.ID, f.PriceKZT, in)
	switch {
	case errors.Is(err, orders.ErrAlreadyOrdered):
		writeError(w, http.StatusConflict, "already_ordered")
	case errors.Is(err, orders.ErrVersionConflict):
		writeError(w, http.StatusConflict, "version_conflict")
	case err != nil:
		a.internalError(w, r, err)
	default:
		a.Log.Info("order created", "number", o.Number)
		writeJSON(w, http.StatusCreated, o)
	}
}
