package pptxpatch

import (
	"encoding/xml"
	"fmt"
	"strconv"
)

// Materialize the bounded DrawingML style cascade into an owned projection.
// Raw source nodes/offsets remain untouched: writes still target the original
// element subtree, not this rendering-only property view.
func resolveNativeLocalTextStyles(body *nativeXMLNode, dialect nativeExtractDialect) (*nativeXMLNode, error) {
	if body == nil {
		return nil, nil
	}
	list, err := nativeSingleton(body, dialect.drawing, "lstStyle", true)
	if err != nil {
		return nil, err
	}
	if requireOnlyNativeAttrs(list) != nil || !onlyNativeXMLSpace(list.Text) {
		return nil, unsupportedNativeTextContent("list style has unmodeled attributes or text")
	}
	levels := map[string]*nativeXMLNode{}
	for _, child := range list.Children {
		if child.Name.Space != dialect.drawing || (child.Name.Local != "defPPr" && (len(child.Name.Local) != 7 || child.Name.Local[:3] != "lvl" || child.Name.Local[3] < '1' || child.Name.Local[3] > '9' || child.Name.Local[4:] != "pPr")) {
			return nil, unsupportedNativeTextContent("list style contains an unmodeled level")
		}
		if levels[child.Name.Local] != nil {
			return nil, fmt.Errorf("pptxpatch: duplicate list style level")
		}
		if err := validateNativeTextStyleProperties(child, dialect, true); err != nil {
			return nil, err
		}
		levels[child.Name.Local] = child
	}
	result := *body
	result.Children = make([]*nativeXMLNode, 0, len(body.Children))
	for _, child := range body.Children {
		if child == list {
			result.Children = append(result.Children, &nativeXMLNode{Name: list.Name})
			continue
		}
		if child.Name != (xml.Name{Space: dialect.drawing, Local: "p"}) {
			result.Children = append(result.Children, child)
			continue
		}
		local, err := nativeSingleton(child, dialect.drawing, "pPr", false)
		if err != nil {
			return nil, err
		}
		if local != nil {
			if err := validateNativeTextStyleProperties(local, dialect, true); err != nil {
				return nil, err
			}
		}
		level := int64(0)
		if local != nil {
			if value, ok := exactNativeAttr(local, "", "lvl"); ok {
				level, err = parseCanonicalNativeInt(value, 0, 8)
				if err != nil {
					return nil, err
				}
			}
		}
		properties := mergeNativeStyleNodes(levels["defPPr"], levels[fmt.Sprintf("lvl%dpPr", level+1)], dialect)
		properties = mergeNativeStyleNodes(properties, local, dialect)
		properties.Name = xml.Name{Space: dialect.drawing, Local: "pPr"}
		if _, ok := exactNativeAttr(properties, "", "lvl"); !ok {
			properties.Attrs = append(properties.Attrs, xml.Attr{Name: xml.Name{Local: "lvl"}, Value: strconv.FormatInt(level, 10)})
		}
		defaults, err := nativeSingleton(properties, dialect.drawing, "defRPr", false)
		if err != nil {
			return nil, err
		}
		filtered := make([]*nativeXMLNode, 0, len(properties.Children))
		for _, p := range properties.Children {
			if p != defaults {
				filtered = append(filtered, p)
			}
		}
		properties.Children = filtered
		paragraph := *child
		paragraph.Children = []*nativeXMLNode{properties}
		for _, run := range child.Children {
			if run == local {
				continue
			}
			if run.Name != (xml.Name{Space: dialect.drawing, Local: "r"}) {
				paragraph.Children = append(paragraph.Children, run)
				continue
			}
			localRun, err := nativeSingleton(run, dialect.drawing, "rPr", false)
			if err != nil {
				return nil, err
			}
			if localRun != nil {
				if err := validateNativeTextStyleProperties(localRun, dialect, false); err != nil {
					return nil, err
				}
			}
			merged := mergeNativeStyleNodes(defaults, localRun, dialect)
			merged.Name = xml.Name{Space: dialect.drawing, Local: "rPr"}
			projected := *run
			projected.Children = []*nativeXMLNode{merged}
			for _, item := range run.Children {
				if item != localRun {
					projected.Children = append(projected.Children, item)
				}
			}
			paragraph.Children = append(paragraph.Children, &projected)
		}
		result.Children = append(result.Children, &paragraph)
	}
	return &result, nil
}

func validateNativeTextStyleProperties(node *nativeXMLNode, dialect nativeExtractDialect, paragraph bool) error {
	attrs := []xml.Name{{Local: "b"}, {Local: "i"}, {Local: "sz"}}
	names := []string{"latin", "ea", "cs", "solidFill"}
	if paragraph {
		attrs = []xml.Name{{Local: "algn"}, {Local: "lvl"}, {Local: "marL"}, {Local: "indent"}}
		names = []string{"buNone", "buChar", "defRPr"}
	}
	if err := requireOnlyNativeAttrs(node, attrs...); err != nil {
		return unsupportedNativeTextContent("unmodeled inherited text property")
	}
	allowed := make([]xml.Name, 0, len(names))
	for _, name := range names {
		allowed = append(allowed, xml.Name{Space: dialect.drawing, Local: name})
	}
	if requireOnlyNativeChildren(node, allowed...) != nil {
		return unsupportedNativeTextContent("unmodeled inherited text property child")
	}
	for _, name := range names {
		child, err := nativeSingleton(node, dialect.drawing, name, false)
		if err != nil {
			return err
		}
		if child != nil && name == "defRPr" {
			if err := validateNativeTextStyleProperties(child, dialect, false); err != nil {
				return err
			}
		}
	}
	if paragraph {
		none, _ := nativeSingleton(node, dialect.drawing, "buNone", false)
		marker, _ := nativeSingleton(node, dialect.drawing, "buChar", false)
		if none != nil && marker != nil {
			return fmt.Errorf("pptxpatch: conflicting inherited bullet properties")
		}
	}
	return nil
}

func mergeNativeStyleNodes(base, override *nativeXMLNode, dialect nativeExtractDialect) *nativeXMLNode {
	merged := &nativeXMLNode{}
	if base != nil {
		merged.Attrs = append(merged.Attrs, base.Attrs...)
		merged.Children = append(merged.Children, base.Children...)
	}
	if override == nil {
		return merged
	}
	for _, attr := range override.Attrs {
		found := false
		for i := range merged.Attrs {
			if merged.Attrs[i].Name == attr.Name {
				merged.Attrs[i] = attr
				found = true
				break
			}
		}
		if !found {
			merged.Attrs = append(merged.Attrs, attr)
		}
	}
	for _, child := range override.Children {
		found := false
		for i, previous := range merged.Children {
			bulletReplacement := child.Name.Space == dialect.drawing && previous.Name.Space == dialect.drawing && (child.Name.Local == "buNone" || child.Name.Local == "buChar") && (previous.Name.Local == "buNone" || previous.Name.Local == "buChar")
			if previous.Name == child.Name || bulletReplacement {
				if child.Name == (xml.Name{Space: dialect.drawing, Local: "defRPr"}) {
					nested := mergeNativeStyleNodes(previous, child, dialect)
					nested.Name = child.Name
					merged.Children[i] = nested
				} else {
					merged.Children[i] = child
				}
				found = true
				break
			}
		}
		if !found {
			merged.Children = append(merged.Children, child)
		}
	}
	return merged
}
