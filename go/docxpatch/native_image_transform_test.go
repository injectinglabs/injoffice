package docxpatch

import (
	"fmt"
	"strings"
	"testing"
)

func TestNativeBoundedInlineImageTransforms(t *testing.T) {
	for _, degrees := range []int64{0, 180} {
		for _, flipH := range []bool{false, true} {
			for _, flipV := range []bool{false, true} {
				parts := transitionalNativeParts()
				parts["Custom/Main.XML"] = strings.Replace(parts["Custom/Main.XML"], `<a:xfrm/>`, fmt.Sprintf(`<a:xfrm rot="%d" flipH="%t" flipV="%t"/>`, degrees*60000, flipH, flipV), 1)
				doc, err := ExtractNativeDocumentV1(buildNativeDOCX(t, nativeEntries(parts)))
				if err != nil {
					t.Fatal(err)
				}
				var drawing *NativeDrawingV1
				for _, run := range doc.Body.Blocks[0].Paragraph.Runs {
					if run.Drawing != nil {
						drawing = run.Drawing
					}
				}
				if drawing == nil || drawing.RotationDegrees == nil || *drawing.RotationDegrees != degrees || drawing.FlipHorizontal == nil || *drawing.FlipHorizontal != flipH || drawing.FlipVertical == nil || *drawing.FlipVertical != flipV {
					t.Fatalf("wrong transform projection: %#v", drawing)
				}
				if *drawing.WidthEMU != 914400 || *drawing.HeightEMU != 457200 {
					t.Fatal("orientation changed source extents")
				}
			}
		}
	}
	for _, attrs := range []string{`rot="5400000"`, `rot="16200000"`, `rot="-10800000"`, `rot="21600000"`, `rot="NaN"`, `flipH="yes"`, `flipV="2"`, `rot="10800000" bogus="1"`, `rot="0" rot="10800000"`, `flipH="true" flipH="false"`} {
		parts := transitionalNativeParts()
		parts["Custom/Main.XML"] = strings.Replace(parts["Custom/Main.XML"], `<a:xfrm/>`, `<a:xfrm `+attrs+`/>`, 1)
		doc, err := ExtractNativeDocumentV1(buildNativeDOCX(t, nativeEntries(parts)))
		if err != nil {
			t.Fatal(err)
		}
		for _, run := range doc.Body.Blocks[0].Paragraph.Runs {
			if run.Drawing != nil {
				t.Fatalf("unsupported transform accepted: %s", attrs)
			}
		}
	}
}
