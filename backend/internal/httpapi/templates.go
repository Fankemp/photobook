package httpapi

import (
	"fmt"
	"net/http"

	"photobook/internal/formats"
	"photobook/internal/pages"
	"photobook/internal/templates"
)

// templateSummary — карточка в каталоге: без внутренних страниц, но с обложкой,
// чтобы фронтенд нарисовал её тем же компонентом, что и книгу.
type templateSummary struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Occasion  string         `json:"occasion"`
	Preview   string         `json:"preview,omitempty"`
	Format    formats.Format `json:"format"`
	PageCount int            `json:"pageCount"`
	Cover     pages.Page     `json:"cover"`
}

type templateDetail struct {
	templateSummary
	Pages []pages.Page `json:"pages"`
}

func summarize(t templates.Template, fmts map[string]formats.Format) (templateSummary, error) {
	f, ok := fmts[t.FormatID]
	if !ok {
		return templateSummary{}, fmt.Errorf("template %s: format %q disappeared from db", t.ID, t.FormatID)
	}
	return templateSummary{
		ID: t.ID, Name: t.Name, Occasion: t.Occasion, Preview: t.Preview,
		Format: f, PageCount: len(t.Pages), Cover: t.Cover,
	}, nil
}

func (a *API) listTemplates(w http.ResponseWriter, r *http.Request) {
	fmts, err := a.Formats.All(r.Context())
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	out := []templateSummary{}
	for _, t := range a.Templates.List() {
		s, err := summarize(t, fmts)
		if err != nil {
			a.internalError(w, r, err)
			return
		}
		out = append(out, s)
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) getTemplate(w http.ResponseWriter, r *http.Request) {
	t, ok := a.Templates.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "template_not_found")
		return
	}
	fmts, err := a.Formats.All(r.Context())
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	s, err := summarize(t, fmts)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, templateDetail{templateSummary: s, Pages: t.Pages})
}
