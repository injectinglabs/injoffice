package docxpatch

import (
	"encoding/xml"
	"strings"
)

func hasNativeFieldBegin(run *nativeXMLNode, wordNS string) bool {
	for _, child := range directNativeChildren(run, wordNS, "fldChar") {
		if value, _ := nativeAttr(child, wordNS, "fldCharType"); value == "begin" {
			return true
		}
	}
	return false
}

// Only one paragraph-local field with a single result run. Instruction and
// boundary XML remain bound by the paragraph/story source digests; only the
// result run enters the native text model and its cached text is discarded.
func (extractor *nativeExtractor) extractFlatPageField(partName, paragraphID string, sequence []*nativeXMLNode) (NativeRunV1, bool, error) {
	refuse := func() (NativeRunV1, bool, error) { return NativeRunV1{}, false, nil }
	if len(sequence) < 5 {
		return refuse()
	}
	wordNS := extractor.wordNS
	metadata := func(run *nativeXMLNode, kind, value string) bool {
		if run.Name != (xml.Name{Space: wordNS, Local: "r"}) || !nativeExactContainer(run) {
			return false
		}
		var content *nativeXMLNode
		for _, child := range run.Children {
			if child.Name == (xml.Name{Space: wordNS, Local: "rPr"}) {
				if !nativeExactParagraphMarkProperties(child, wordNS) {
					return false
				}
				continue
			}
			if content != nil {
				return false
			}
			content = child
		}
		if len(directNativeChildren(run, wordNS, "rPr")) > 1 || content == nil || content.Name != (xml.Name{Space: wordNS, Local: kind}) {
			return false
		}
		if kind == "fldChar" {
			actual, present := nativeAttr(content, wordNS, "fldCharType")
			return present && actual == value && nativeExactLeaf(content, xml.Name{Space: wordNS, Local: "fldCharType"})
		}
		if len(content.Children) != 0 {
			return false
		}
		for _, attr := range content.Attrs {
			if attr.Name != (xml.Name{Space: "http://www.w3.org/XML/1998/namespace", Local: "space"}) || attr.Value != "preserve" {
				return false
			}
		}
		return strings.Trim(content.Text, " \t\r\n") == value
	}
	if !metadata(sequence[0], "fldChar", "begin") || !metadata(sequence[2], "fldChar", "separate") || !metadata(sequence[4], "fldChar", "end") {
		return refuse()
	}
	instruction := "PAGE"
	if !metadata(sequence[1], "instrText", instruction) {
		instruction = "NUMPAGES"
		if !metadata(sequence[1], "instrText", instruction) {
			return refuse()
		}
	}
	result := sequence[3]
	if result.Name != (xml.Name{Space: wordNS, Local: "r"}) || !nativeExactContainer(result) || len(directNativeChildren(result, wordNS, "rPr")) > 1 {
		return refuse()
	}
	runs, unsafe, err := extractor.extractRunNode(partName, paragraphID, result)
	if err != nil {
		return NativeRunV1{}, false, err
	}
	if unsafe || len(runs) != 1 || runs[0].Kind != "text" {
		return refuse()
	}
	runs[0].PageField = instruction
	runs[0].Text = nativeString("")
	return runs[0], true, nil
}
