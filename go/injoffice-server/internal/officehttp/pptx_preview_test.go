package officehttp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPPTXPreviewQueryIsClosed(t *testing.T) {
	for _, query := range []string{"slide=-1", "slide=01", "slide=+1", "slide=", "slide=1&slide=2", "font_manifest_path=/tmp/font.json", "slide=1;foo=2", "slide=%zz"} {
		request := httptest.NewRequest(http.MethodPost, PPTXPreviewPath, nil)
		request.URL.RawQuery = query
		if _, err := parsePPTXPreviewSlide(request); err == nil {
			t.Fatalf("accepted %q", query)
		}
	}
	for _, query := range []string{"", "slide=0", "slide=12"} {
		request := httptest.NewRequest(http.MethodPost, PPTXPreviewPath+"?"+query, nil)
		if _, err := parsePPTXPreviewSlide(request); err != nil {
			t.Fatalf("refused %q: %v", query, err)
		}
	}
}

func TestPPTXPreviewDisabledBusyAndRequestBudgets(t *testing.T) {
	options := PPTXPreviewOptions{WorkerPath: "/operator/worker.js", FontManifestPath: "/operator/fonts.json"}
	for _, test := range []struct {
		method  string
		options PPTXPreviewOptions
		busy    bool
		code    int
	}{
		{http.MethodGet, options, false, http.StatusMethodNotAllowed},
		{http.MethodPost, PPTXPreviewOptions{}, false, http.StatusServiceUnavailable},
		{http.MethodPost, PPTXPreviewOptions{WorkerPath: "relative.js", FontManifestPath: "/fonts.json"}, false, http.StatusServiceUnavailable},
		{http.MethodPost, options, true, http.StatusServiceUnavailable},
	} {
		gate := make(chan struct{}, 1)
		if test.busy {
			gate <- struct{}{}
		}
		response := httptest.NewRecorder()
		handlePPTXPreview(response, httptest.NewRequest(test.method, PPTXPreviewPath, strings.NewReader("invalid")), test.options, gate)
		if response.Code != test.code || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("response=%d %s", response.Code, response.Body.String())
		}
	}
	gate := make(chan struct{}, 1)
	request := httptest.NewRequest(http.MethodPost, PPTXPreviewPath, bytes.NewReader(make([]byte, 8*1024*1024+1)))
	request.Header.Set("Content-Type", PPTXContentType)
	response := httptest.NewRecorder()
	handlePPTXPreview(response, request, options, gate)
	if response.Code != http.StatusRequestEntityTooLarge || len(gate) != 0 {
		t.Fatalf("oversize/gate: %d %d", response.Code, len(gate))
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := pptxPreviewInput(ctx, []byte("invalid"), 0, options); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestPPTXPreviewInputBindsOriginalPackageWithoutStoring(t *testing.T) {
	data := readPinned(t, commonPPTXSHA, "officecompat", "corpus", "generated", "packages", "pptx-transitional-common.pptx")
	before := append([]byte(nil), data...)
	input, err := pptxPreviewInput(context.Background(), data, 0, PPTXPreviewOptions{FontManifestPath: "/operator/fonts.json"})
	if err != nil {
		t.Fatal(err)
	}
	if input["package_sha256"] != fmt.Sprintf("%x", sha256.Sum256(data)) || input["font_manifest_path"] != "/operator/fonts.json" || !bytes.Equal(data, before) {
		t.Fatal("source/config identity drift")
	}
	if _, err := pptxPreviewInput(context.Background(), data, 999999, PPTXPreviewOptions{}); err == nil {
		t.Fatal("accepted missing slide")
	}
}

func TestPPTXPreviewWorkerProtocolBudgetAndDeadline(t *testing.T) {
	worker := previewFixtureWorker(t, `const payload=Buffer.from(JSON.stringify({protocol:'injoffice.docx.page-paint-worker',version:1,id:'preview',ok:true,result:{}})); const h=Buffer.alloc(4); h.writeUInt32BE(payload.length); process.stdout.write(Buffer.concat([h,payload]));`)
	if _, err := compilePreviewWorker(context.Background(), worker.WorkerPath, "injoffice.pptx.preview-worker", map[string]any{}, 1024, 1024); err == nil {
		t.Fatal("accepted wrong worker protocol")
	}
	if _, err := compilePreviewWorker(context.Background(), worker.WorkerPath, "injoffice.pptx.preview-worker", map[string]any{}, 1, 1024); err == nil {
		t.Fatal("accepted oversized input frame")
	}
	if _, err := compilePreviewWorker(context.Background(), worker.WorkerPath, "injoffice.docx.page-paint-worker", map[string]any{}, 1024, 20); err == nil {
		t.Fatal("accepted oversized output frame")
	}
	hung := previewFixtureWorker(t, "setInterval(()=>{},1000);")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, err := compilePreviewWorker(ctx, hung.WorkerPath, "injoffice.pptx.preview-worker", map[string]any{}, 1024, 1024); err == nil || ctx.Err() == nil {
		t.Fatal("worker ignored deadline")
	}
}
