package httpapi

import (
	"net/http"
)

type startUploadRequest struct {
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

type startUploadResponse struct {
	AssetID   string `json:"assetId"`
	UploadURL string `json:"uploadUrl"` // браузер загружает сюда файл методом PUT
}

func (a *API) startUpload(w http.ResponseWriter, r *http.Request) {
	b, ok := a.bookFromPath(w, r)
	if !ok {
		return
	}
	var req startUploadRequest
	if err := readJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	as, url, err := a.Assets.StartUpload(r.Context(), b.ID, req.ContentType, req.Size)
	if err != nil {
		a.assetError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, startUploadResponse{AssetID: as.ID, UploadURL: url})
}

type completeUploadRequest struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

func (a *API) completeUpload(w http.ResponseWriter, r *http.Request) {
	b, ok := a.bookFromPath(w, r)
	if !ok {
		return
	}
	var req completeUploadRequest
	if err := readJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request")
		return
	}
	as, err := a.Assets.CompleteUpload(r.Context(), b.ID, r.PathValue("id"), req.Width, req.Height)
	if err != nil {
		a.assetError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, assetInfo{ID: as.ID, Width: as.WidthPx, Height: as.HeightPx})
}

// assetImage перенаправляет браузер на временную ссылку в хранилище.
// Так в JSON страниц и в <img src> живёт постоянный адрес, а сама картинка
// отдаётся хранилищем напрямую, не нагружая наш сервер.
func (a *API) assetImage(w http.ResponseWriter, r *http.Request) {
	b, ok := a.bookFromPath(w, r)
	if !ok {
		return
	}
	as, err := a.Assets.Get(r.Context(), b.ID, r.PathValue("id"))
	if err != nil {
		a.assetError(w, r, err)
		return
	}
	if as.Status != "uploaded" {
		writeError(w, http.StatusNotFound, "asset_not_found")
		return
	}
	url, err := a.Assets.ImageURL(r.Context(), as)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	// Ссылка живёт час; браузеру разрешаем запомнить редирект на 10 минут.
	w.Header().Set("Cache-Control", "private, max-age=600")
	http.Redirect(w, r, url, http.StatusFound)
}

func (a *API) assetError(w http.ResponseWriter, r *http.Request, err error) {
	if status, code, ok := assetErrorCode(err); ok {
		writeError(w, status, code)
		return
	}
	a.internalError(w, r, err)
}
