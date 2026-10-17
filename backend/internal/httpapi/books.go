package httpapi

import (
	"errors"
	"net/http"
	"time"

	"photobook/internal/assets"
	"photobook/internal/books"
	"photobook/internal/formats"
	"photobook/internal/pages"
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

// bookFromPath находит книгу по токену из URL. Если не нашлась — сам отвечает 404.
func (a *API) bookFromPath(w http.ResponseWriter, r *http.Request) (books.Book, bool) {
	token := r.PathValue("token")
	if !books.ValidToken(token) {
		writeError(w, http.StatusNotFound, "book_not_found")
		return books.Book{}, false
	}
	b, err := a.Books.GetByToken(r.Context(), token)
	if errors.Is(err, books.ErrNotFound) {
		writeError(w, http.StatusNotFound, "book_not_found")
		return books.Book{}, false
	}
	if err != nil {
		a.internalError(w, r, err)
		return books.Book{}, false
	}
	return b, true
}

type assetInfo struct {
	ID     string `json:"id"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// bookResponse — книга вместе с форматом (фронтенду нужны размеры, чтобы её
// нарисовать) и списком загруженных фото (размеры нужны редактору кадра).
type bookResponse struct {
	books.Book
	Format formats.Format `json:"format"`
	Assets []assetInfo    `json:"assets"`
}

func (a *API) getBook(w http.ResponseWriter, r *http.Request) {
	b, ok := a.bookFromPath(w, r)
	if !ok {
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
	list := []assetInfo{}
	for _, as := range uploaded {
		list = append(list, assetInfo{ID: as.ID, Width: as.WidthPx, Height: as.HeightPx})
	}
	writeJSON(w, http.StatusOK, bookResponse{Book: b, Format: f, Assets: list})
}

type saveBookRequest struct {
	Version int          `json:"version"` // версия, которую клиент загрузил или сохранил последней
	Cover   pages.Page   `json:"cover"`
	Pages   []pages.Page `json:"pages"`
}

type saveBookResponse struct {
	Version   int       `json:"version"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// saveBook — автосохранение: клиент присылает обложку и страницы целиком.
func (a *API) saveBook(w http.ResponseWriter, r *http.Request) {
	b, ok := a.bookFromPath(w, r)
	if !ok {
		return
	}
	var req saveBookRequest
	if err := readJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}

	f, err := a.Formats.Get(r.Context(), b.FormatID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	all := append([]pages.Page{req.Cover}, req.Pages...)
	if len(req.Pages) != f.Pages || pages.ValidateAll(all) != nil {
		writeError(w, http.StatusBadRequest, "invalid_pages")
		return
	}

	// Ссылаться можно только на свои загруженные фото: иначе по чужому id
	// можно было бы «утащить» фото из другой книги.
	uploaded, err := a.Assets.ListUploaded(r.Context(), b.ID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	for _, p := range all {
		for _, e := range p.Elements {
			if e.Type == pages.PhotoSlot && e.AssetID != nil {
				if _, ok := uploaded[*e.AssetID]; !ok {
					writeError(w, http.StatusBadRequest, "unknown_asset")
					return
				}
			}
		}
	}

	version, updatedAt, err := a.Books.SavePages(r.Context(), b.ID, req.Version, req.Cover, req.Pages)
	if errors.Is(err, books.ErrConflict) {
		writeError(w, http.StatusConflict, "version_conflict")
		return
	}
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, saveBookResponse{Version: version, UpdatedAt: updatedAt})
}

// assetErrorCode переводит ошибки модуля assets в коды для клиента.
func assetErrorCode(err error) (int, string, bool) {
	switch {
	case errors.Is(err, assets.ErrNotFound):
		return http.StatusNotFound, "asset_not_found", true
	case errors.Is(err, assets.ErrUnsupportedType):
		return http.StatusBadRequest, "unsupported_type", true
	case errors.Is(err, assets.ErrTooLarge):
		return http.StatusBadRequest, "file_too_large", true
	case errors.Is(err, assets.ErrTooMany):
		return http.StatusBadRequest, "too_many_files", true
	case errors.Is(err, assets.ErrNotUploaded):
		return http.StatusBadRequest, "not_uploaded", true
	case errors.Is(err, assets.ErrBadImage):
		return http.StatusBadRequest, "bad_image", true
	}
	return 0, "", false
}
