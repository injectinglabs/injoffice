package pptxpatch

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func nativeLevelTextFixture(t *testing.T, strict bool, localLevel bool, ambiguous bool, customize ...func(map[string]string)) []byte {
	t.Helper()
	return nativeExtractFixture(t, nativeExtractFixtureOptions{strict: strict, mutate: func(parts map[string]string) {
		drawing := nsDrawingTransitional
		if strict {
			drawing = nsDrawingStrict
		}
		style := `<p:defaultTextStyle xmlns:a="` + drawing + `"><a:lvl1pPr algn="l" marL="0" indent="0"><a:buNone/><a:defRPr b="0" i="0" sz="2000"><a:latin typeface="Arial"/><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:defRPr></a:lvl1pPr></p:defaultTextStyle>`
		parts["relocated/deck.xml"] = strings.Replace(parts["relocated/deck.xml"], `</p:presentation>`, style+`</p:presentation>`, 1)
		part := "relocated/slides/slide-a.xml"
		slide := parts[part]
		slide = strings.Replace(slide, `<a:pPr algn="ctr" lvl="0"><a:buNone/></a:pPr>`, `<a:pPr lvl="0"/>`, 1)
		slide = strings.Replace(slide, `<a:rPr b="1" i="0" sz="3200"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr>`, `<a:rPr b="1" lang="tr-TR"/>`, 1)
		slide = strings.Replace(slide, `<a:rPr b="0" i="0" sz="3200"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr>`, `<a:rPr lang="en-US"/>`, 1)
		list := `<a:lstStyle>`
		if localLevel {
			list += `<a:lvl1pPr algn="r"><a:defRPr sz="2800"/></a:lvl1pPr>`
		}
		if ambiguous {
			list += `<a:defPPr algn="r"><a:defRPr sz="2600"/></a:defPPr>`
		}
		list += `</a:lstStyle>`
		parts[part] = strings.Replace(slide, `<a:lstStyle/>`, list, 1)
		for _, update := range customize {
			update(parts)
		}
	}})
}

func TestNativePresentationLevelMetadataRemainsStrict(t *testing.T) {
	for _, item := range []struct{ name, from, to string }{
		{"direct text", `<a:lvl1pPr algn="l"`, `unmodeled<a:lvl1pPr algn="l"`},
		{"malformed inherited size", `sz="2000"`, `sz="bad"`},
		{"duplicate level", `</p:defaultTextStyle>`, `<a:lvl1pPr/></p:defaultTextStyle>`},
		{"unmodeled unused level", `</p:defaultTextStyle>`, `<a:lvl2pPr unsupported="1"/></p:defaultTextStyle>`},
		{"presentation defPPr", `</p:defaultTextStyle>`, `<a:defPPr><a:defRPr sz="2600"/></a:defPPr></p:defaultTextStyle>`},
	} {
		t.Run(item.name, func(t *testing.T) {
			original := nativeLevelTextFixture(t, false, true, false, func(parts map[string]string) {
				parts["relocated/deck.xml"] = strings.Replace(parts["relocated/deck.xml"], item.from, item.to, 1)
			})
			deck, err := ExtractNativePPTX(original, nativeTestExtractOptions())
			if err == nil {
				e := deck.Slides[0].Elements[0]
				if e.Compatibility.Status != NativeCompatibilityStatusRefused || len(*e.Paragraphs) != 0 {
					t.Fatal("unqualified or malformed default markup painted")
				}
			}
		})
	}
}

func TestNativePresentationMatchingLevelStyles(t *testing.T) {
	for _, strict := range []bool{false, true} {
		for _, local := range []bool{false, true} {
			original := nativeLevelTextFixture(t, strict, local, false)
			before := bytes.Clone(original)
			deck, err := ExtractNativePPTX(original, nativeMutationExtractOptions())
			if err != nil {
				t.Fatal(err)
			}
			e := deck.Slides[0].Elements[0]
			p := (*e.Paragraphs)[0]
			size := int64(2000)
			align := NativeTextAlignLeft
			if local {
				size = 2800
				align = NativeTextAlignRight
			}
			if e.Compatibility.Status != NativeCompatibilityStatusPreserveOnly || *p.Align != align || len(p.Runs) != 2 || *p.Runs[0].FontSizeHundredthPt != size || *p.Runs[1].FontSizeHundredthPt != size || *p.Runs[0].FontFamily != "Arial" || !*p.Runs[0].Bold || *p.Runs[1].Bold {
				t.Fatalf("level cascade lost: %+v", p)
			}
			paragraphs := nativeMutationParagraphs("Replace")
			_, err = ApplyNativePPTXMutations(original, NativePPTXMutationRequest{ExpectedSourceRevision: *deck.SourceRevision, Operations: []NativePPTXMutation{{OperationID: "replace", Kind: NativePPTXReplaceText, ElementID: e.ID, ExpectedFingerprintSHA256: e.Source.FingerprintSHA256, Paragraphs: &paragraphs}}})
			if err == nil || !strings.Contains(err.Error(), "preview-only") {
				t.Fatalf("resolved defaults granted editing: %v", err)
			}
			if !bytes.Equal(original, before) {
				t.Fatal("source mutated")
			}
			if dir := os.Getenv("INJOFFICE_PPTX_LEVEL_FIXTURE_DIR"); dir != "" && !strict {
				if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("level-%d.pptx", size)), original, 0600); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
}

// Local PowerPoint 16.112.4 probes selected presentation lvl1=20pt over a
// local defPPr=26pt, while local lvl1=28pt won. Do not encode a guessed defPPr
// source-layer merge as an exact projection; only matching levels are admitted.
func TestNativePresentationDefPPrAmbiguityRemainsRefused(t *testing.T) {
	for _, strict := range []bool{false, true} {
		deck, err := ExtractNativePPTX(nativeLevelTextFixture(t, strict, false, true), nativeTestExtractOptions())
		if err != nil {
			t.Fatal(err)
		}
		e := deck.Slides[0].Elements[0]
		if e.Compatibility.Status != NativeCompatibilityStatusRefused || len(*e.Paragraphs) != 0 {
			t.Fatal("ambiguous defPPr was painted")
		}
	}
}
