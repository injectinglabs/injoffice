package pptxpatch

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestNativeMeasuredPreviewBrowserFixture(t *testing.T) {
	output := os.Getenv("INJOFFICE_PPTX_PREVIEW_FIXTURE")
	if output == "" {
		t.Skip("optional measured preview source export")
	}
	for _, withBullets := range []bool{false, true} {
		input := nativeExtractFixture(t, nativeExtractFixtureOptions{mutate: func(parts map[string]string) {
			part := "relocated/slides/slide-a.xml"
			slide := parts[part]
			start, end := strings.Index(slide, "<p:sp>"), strings.Index(slide, "</p:sp>")+len("</p:sp>")
			shape := slide[start:end]
			shape = strings.ReplaceAll(shape, `typeface="Aptos"`, `typeface="DejaVu Sans"`)
			shape = strings.ReplaceAll(shape, `b="1"`, `b="0"`)
			shape = strings.Replace(shape, `sz="3200"`, `sz="1200"`, 1)
			shape = strings.Replace(shape, `sz="3200"`, `sz="2400"`, 1)
			shape = strings.Replace(shape, "Hello ", "Small ", 1)
			shape = strings.Replace(shape, "world", "large", 1)
			shapes := ""
			for i, anchor := range []string{"t", "ctr", "b"} {
				item := strings.Replace(shape, `id="2"`, fmt.Sprintf(`id="%d"`, i+2), 1)
				item = strings.Replace(item, `x="914400" y="457200"`, fmt.Sprintf(`x="%d" y="1000000"`, 500000+i*3900000), 1)
				item = strings.Replace(item, `cx="4572000" cy="914400"`, `cx="3300000" cy="3000000"`, 1)
				item = strings.Replace(item, `<a:bodyPr/>`, `<a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" wrap="none" anchor="`+anchor+`"/>`, 1)
				if withBullets {
					item = strings.Replace(item, `<a:pPr algn="ctr" lvl="0"><a:buNone/></a:pPr>`, `<a:pPr algn="l" lvl="2" marL="400000" indent="-300000"><a:buChar char="▪"/></a:pPr>`, 1)
					item = strings.Replace(item, `wrap="none"`, `wrap="square"`, 1)
					item = strings.Replace(item, `<a:t>large</a:t>`, `<a:t>large repeated text wraps here</a:t>`, 1)
				}
				shapes += item
			}
			parts[part] = slide[:start] + shapes + slide[end:]
		}})
		if _, err := ExtractNativePPTX(input, nativeTestExtractOptions()); err != nil {
			t.Fatal(err)
		}
		name := output
		if withBullets {
			name = strings.TrimSuffix(output, ".pptx") + "-bullets.pptx"
		}
		if err := os.WriteFile(name, input, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
