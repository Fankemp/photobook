package httpapi

import (
	"errors"
	"net/http"
	"time"

	"photobook/internal/assets"
)

type startUploadRequest struct {
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`  // необязательно: хеш файла — не загружать одно фото дважды
	TakenAt     string `json:"takenAt"` // необязательно: дата съёмки из EXIF, «2006-01-02T15:04:05»
}

type startUploadResponse struct {
	AssetID   string `json:"assetId"`
	UploadURL string `json:"uploadUrl,omitempty"` // браузер загружает сюда файл методом PUT
	// Такое же фото уже есть в книге: загружать не нужно, assetId — его id.
	Duplicate bool `json:"duplicate,omitempty"`
}

// assetInfo — фото книги для редактора и лотка «Мои фото».
type assetInfo struct {
	ID       string `json:"id"`
	Width    int    `json:"width"` // с учётом поворота, как фото видит человек
	Height   int    `json:"height"`
	TakenAt  string `json:"takenAt,omitempty"` // дата съёмки, «2006-01-02T15:04:05»
	SHA256   string `json:"sha256,omitempty"`
	Removed  bool   `json:"removed,omitempty"` // удалено из лотка (страницы ещё могут на него ссылаться)
	Viewable bool   `json:"viewable"`          // картинку уже можно показать (HEIC — когда готова миниатюра)
}

const takenAtLayout = "2006-01-02T15:04:05"

func toAssetInfo(as assets.Asset) assetInfo {
	info := assetInfo{ID: as.ID, Width: as.WidthPx, Height: as.HeightPx, SHA256: as.SHA256, Removed: as.Removed,
		Viewable: as.Ready() || as.ContentType == "image/jpeg" || as.ContentType == "image/png"}
	if as.TakenAt != nil {
		info.TakenAt = as.TakenAt.Format(takenAtLayout)
	}
	return info
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
	if locked, err := a.Books.IsLocked(r.Context(), b.ID); err != nil || locked {
		if err != nil {
			a.internalError(w, r, err)
		} else {
			writeError(w, http.StatusConflict, "book_locked")
		}
		return
	}
	up := assets.Upload{ContentType: req.ContentType, Size: req.Size, SHA256: req.SHA256}
	if t, err := time.Parse(takenAtLayout, req.TakenAt); err == nil && t.Year() >= 1900 && t.Year() <= 2200 {
		up.TakenAt = &t
	}
	as, url, err := a.Assets.StartUpload(r.Context(), b.ID, up)
	if errors.Is(err, assets.ErrDuplicate) {
		writeJSON(w, http.StatusOK, startUploadResponse{AssetID: as.ID, Duplicate: true})
		return
	}
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
	writeJSON(w, http.StatusOK, toAssetInfo(as))
}

// listAssets — фото книги (лоток «Мои фото»). Редактор спрашивает, пока
// для HEIC готовится миниатюра.
func (a *API) listAssets(w http.ResponseWriter, r *http.Request) {
	b, ok := a.bookFromPath(w, r)
	if !ok {
		return
	}
	list, err := a.Assets.List(r.Context(), b.ID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	out := make([]assetInfo, 0, len(list))
	for _, as := range list {
		out = append(out, toAssetInfo(as))
	}
	writeJSON(w, http.StatusOK, out)
}

// removeAsset и restoreAsset — удалить фото из лотка и «Отменить».
// Рамки с этим фото освобождает сам редактор (автосохранением).
func (a *API) removeAsset(w http.ResponseWriter, r *http.Request)  { a.setRemoved(w, r, true) }
func (a *API) restoreAsset(w http.ResponseWriter, r *http.Request) { a.setRemoved(w, r, false) }

func (a *API) setRemoved(w http.ResponseWriter, r *http.Request, removed bool) {
	b, ok := a.bookFromPath(w, r)
	if !ok {
		return
	}
	if locked, err := a.Books.IsLocked(r.Context(), b.ID); err != nil || locked {
		if err != nil {
			a.internalError(w, r, err)
		} else {
			writeError(w, http.StatusConflict, "book_locked")
		}
		return
	}
	if err := a.Assets.SetRemoved(r.Context(), b.ID, r.PathValue("id"), removed); err != nil {
		a.assetError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
	url, final, err := a.Assets.ImageURL(r.Context(), as)
	if errors.Is(err, assets.ErrNotReady) {
		w.Header().Set("Cache-Control", "no-store")
		writeError(w, http.StatusNotFound, "not_ready")
		return
	}
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	if final {
		// Ссылка живёт час; браузеру разрешаем запомнить редирект на 10 минут.
		w.Header().Set("Cache-Control", "private, max-age=600")
	} else {
		// Миниатюра ещё готовится: не запоминать, в следующий раз отдадим её.
		w.Header().Set("Cache-Control", "no-store")
	}
	http.Redirect(w, r, url, http.StatusFound)
}

func (a *API) assetError(w http.ResponseWriter, r *http.Request, err error) {
	if status, code, ok := assetErrorCode(err); ok {
		writeError(w, status, code)
		return
	}
	a.internalError(w, r, err)
}
