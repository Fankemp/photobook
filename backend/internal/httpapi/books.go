package httpapi

import (
	"errors"
	"net/http"

	"photobook/internal/books"
	"photobook/internal/formats"
)

type createBookRequest struct {
	TemplateID string `json:"templateId"`
}

type createBookResponse struct {
	Token string `json:"token"`
}

// createBook создаёт книгу по шаблону и возвращает секретный токен.
func (a *API) createBook(w http.ResponseWriter, r *http.Request) {
	var req createBookRequest
	if err := readJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	t, ok := a.Templates.Get(req.TemplateID)
	if !ok {
		writeError(w, http.StatusNotFound, "template_not_found")
		return
	}
	b, err := books.NewFromTemplate(t)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	b, err = a.Books.Create(r.Context(), b)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, createBookResponse{Token: b.Token})
}

// bookResponse — книга вместе с форматом: фронтенду нужны размеры, чтобы её нарисовать.
type bookResponse struct {
	books.Book
	Format formats.Format `json:"format"`
}

func (a *API) getBook(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if !books.ValidToken(token) {
		writeError(w, http.StatusNotFound, "book_not_found")
		return
	}
	b, err := a.Books.GetByToken(r.Context(), token)
	if errors.Is(err, books.ErrNotFound) {
		writeError(w, http.StatusNotFound, "book_not_found")
		return
	}
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	f, err := a.Formats.Get(r.Context(), b.FormatID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, bookResponse{Book: b, Format: f})
}
