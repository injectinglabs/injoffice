package officehttp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestDOCXPreviewDisabledAndReadOnly(t *testing.T) {
	handler := NewHandler(nil)
	for _, test := range []struct {
		method string
		status int
	}{{http.MethodGet, 405}, {http.MethodPost, 503}} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(test.method, DOCXPreviewPath, bytes.NewReader([]byte("invalid"))))
		if response.Code != test.status {
			t.Fatalf("status %d want %d", response.Code, test.status)
		}
	}
}

func TestDOCXPreviewInputRejectsInvalidPackage(t *testing.T) {
	if _, err := docxPreviewInput(context.Background(), []byte("not a zip")); err == nil {
		t.Fatal("accepted malformed package")
	}
}

// Opt-in integration test uses the real built compiler, never fabricated paths.
func TestDOCXPreviewRealWorker(t *testing.T) {
	worker := os.Getenv("INJOFFICE_TEST_DOCX_PREVIEW_WORKER")
	fixture := os.Getenv("INJOFFICE_TEST_DOCX_PREVIEW_FIXTURE")
	if worker == "" || fixture == "" {
		t.Skip("set worker and qualified fixture paths to exercise real native compilation")
	}
	data, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandlerWithDOCXPreview(nil, DOCXPreviewOptions{WorkerPath: worker})
	request := httptest.NewRequest(http.MethodPost, DOCXPreviewPath, bytes.NewReader(data))
	request.Header.Set("Content-Type", DOCXContentType)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	var result map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || !bytes.Contains(result["page_paint_output"], []byte(`"status":"painted"`)) {
		var request struct {
			PaginationRequest struct {
				Document struct {
					UnsupportedCapabilities any `json:"unsupported_capabilities"`
				} `json:"document"`
			} `json:"pagination_request"`
			PaginatedLayout struct {
				Diagnostics any `json:"diagnostics"`
			} `json:"paginated_layout"`
		}
		_ = json.Unmarshal(result["page_paint_request"], &request)
		var output struct {
			Diagnostics any `json:"diagnostics"`
		}
		_ = json.Unmarshal(result["page_paint_output"], &output)
		t.Fatalf("native preview status=%d errors=%s diagnostics=%+v paint=%+v", response.Code, result["error"], request.PaginatedLayout.Diagnostics, output.Diagnostics)
	}
	var output struct {
		Provenance struct {
			PackageSHA256 string `json:"package_sha256"`
		} `json:"provenance"`
		Pages []struct {
			Commands []struct {
				Kind string `json:"kind"`
				Path []any  `json:"path"`
			} `json:"commands"`
		} `json:"pages"`
	}
	if err := json.Unmarshal(result["page_paint_output"], &output); err != nil {
		t.Fatal(err)
	}
	if len(output.Pages) != 2 {
		t.Fatalf("native pages=%d want 2", len(output.Pages))
	}
	if output.Provenance.PackageSHA256 != fmt.Sprintf("sha256:%x", sha256.Sum256(data)) {
		t.Fatal("paint does not bind exact input bytes")
	}
	for _, page := range output.Pages {
		glyphs := 0
		for _, command := range page.Commands {
			if command.Kind == "fill_glyph_path" && len(command.Path) > 0 {
				glyphs++
			}
		}
		if glyphs == 0 {
			t.Fatal("native page has no real glyph contours")
		}
	}
}
