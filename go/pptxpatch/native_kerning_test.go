package pptxpatch

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeKerningOfficeFixture(t *testing.T) {
	dir := os.Getenv("INJOFFICE_PPTX_KERNING_FIXTURE_DIR")
	if dir == "" {
		t.Skip("optional local Office/native kerning qualification")
	}
	for _, threshold := range []int{0, 3200, 3201, 400000} {
		original := nativeExtractFixture(t, nativeExtractFixtureOptions{mutate: func(parts map[string]string) {
			part := "relocated/slides/slide-a.xml"
			slide := strings.ReplaceAll(parts[part], `typeface="Aptos"`, `typeface="Arial"`)
			slide = strings.ReplaceAll(slide, `<a:rPr b="1"`, `<a:rPr b="0"`)
			slide = strings.ReplaceAll(slide, `<a:rPr `, fmt.Sprintf(`<a:rPr kern="%d" `, threshold))
			slide = strings.ReplaceAll(slide, `algn="ctr"`, `algn="l"`)
			slide = strings.ReplaceAll(slide, `>Hello </a:t>`, `>AVAVAVAVAV </a:t>`)
			parts[part] = slide
		}})
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("kern-%d.pptx", threshold)), original, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestNativeKerningThresholdRoundTrip(t *testing.T) {
	for _, strict := range []bool{false, true} {
		original := nativeExtractFixture(t, nativeExtractFixtureOptions{strict: strict, mutate: func(parts map[string]string) {
			part := "relocated/slides/slide-a.xml"
			parts[part] = strings.Replace(parts[part], `<a:rPr b="1"`, `<a:rPr kern="1200" b="1"`, 1)
		}})
		before := bytes.Clone(original)
		deck, err := ExtractNativePPTX(original, nativeMutationExtractOptions())
		if err != nil {
			t.Fatal(err)
		}
		e := deck.Slides[0].Elements[0]
		run := (*e.Paragraphs)[0].Runs[0]
		if run.KerningMinSizeHundredthPt == nil || *run.KerningMinSizeHundredthPt != 1200 {
			t.Fatal("source threshold lost")
		}
		for _, threshold := range []int64{0, 1200, 400000} {
			paragraphs := nativeMutationParagraphs("AV")
			paragraphs[0].Runs[0].KerningMinSizeHundredthPt = &threshold
			request := NativePPTXMutationRequest{ExpectedSourceRevision: *deck.SourceRevision, Operations: []NativePPTXMutation{{OperationID: "replace", Kind: NativePPTXReplaceText, ElementID: e.ID, ExpectedFingerprintSHA256: e.Source.FingerprintSHA256, Paragraphs: &paragraphs}}}
			result, err := ApplyNativePPTXMutations(original, request)
			if err != nil {
				t.Fatal(err)
			}
			reopened, err := ExtractNativePPTX(result, nativeMutationExtractOptions())
			if err != nil {
				t.Fatal(err)
			}
			got := (*reopened.Slides[0].Elements[0].Paragraphs)[0].Runs[0]
			if got.KerningMinSizeHundredthPt == nil || *got.KerningMinSizeHundredthPt != threshold {
				t.Fatal("saved threshold lost")
			}
		}
		if !bytes.Equal(before, original) {
			t.Fatal("original bytes changed")
		}
	}
}

func TestNativeKerningThresholdSourceBoundsBeforePrecedence(t *testing.T) {
	for _, value := range []string{"-1", "400001", "1.5", "01", "bad", "9223372036854775808"} {
		original := nativeLevelTextFixture(t, false, true, false, func(parts map[string]string) {
			parts["relocated/deck.xml"] = strings.Replace(parts["relocated/deck.xml"], `sz="2000"`, `kern="`+value+`" sz="2000"`, 1)
			parts["relocated/slides/slide-a.xml"] = strings.Replace(parts["relocated/slides/slide-a.xml"], `sz="2800"`, `kern="1200" sz="2800"`, 1)
		})
		deck, err := ExtractNativePPTX(original, nativeMutationExtractOptions())
		if err == nil && deck.Slides[0].Elements[0].Compatibility.Status != NativeCompatibilityStatusRefused {
			t.Fatalf("invalid inherited threshold %q hidden by valid local", value)
		}
	}
	for _, threshold := range []int64{-1, 400001} {
		paragraphs := nativeMutationParagraphs("AV")
		paragraphs[0].Runs[0].KerningMinSizeHundredthPt = &threshold
		if err := validateNativeMutationParagraphs(paragraphs, &nativeMutationBudget{}); err == nil {
			t.Fatal("invalid mutation threshold accepted")
		}
	}
}
