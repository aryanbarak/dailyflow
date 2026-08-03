import { describe, expect, it } from "vitest";
import { extractBulletItems, findLabeledSentence, findSection, findAllSections, splitByHeadings } from "./projectBriefMarkdownSections";

describe("splitByHeadings", () => {
  it("splits ATX headings into sections and normalizes numeric prefixes", () => {
    const sections = splitByHeadings("# Title\nintro\n\n## 2. Current Project Phase\nCurrent phase: X.\n\n## Next Sprint\nY.\n");
    expect(sections).toHaveLength(3);
    expect(sections[1].headingTextNormalized).toBe("current project phase");
    expect(sections[2].headingTextNormalized).toBe("next sprint");
  });

  it("discards content before the first heading", () => {
    const sections = splitByHeadings("no heading yet\n\n## Only Section\nbody\n");
    expect(sections).toHaveLength(1);
    expect(sections[0].bodyText.trim()).toBe("body");
  });

  it("strips trailing ATX closing hashes", () => {
    const sections = splitByHeadings("## Heading ##\nbody\n");
    expect(sections[0].headingText).toBe("Heading");
  });
});

describe("findSection / findAllSections", () => {
  const sections = splitByHeadings("## Risks\na\n\n## Risks\nb\n\n## Other\nc\n");

  it("findSection returns the first match", () => {
    const match = findSection(sections, ["risks"]);
    expect(match?.bodyText.trim()).toBe("a");
  });

  it("findAllSections returns every match, revealing a duplicate heading", () => {
    expect(findAllSections(sections, ["risks"])).toHaveLength(2);
  });
});

describe("extractBulletItems", () => {
  it("extracts top-level `-` and `*` bullets in document order", () => {
    const [section] = splitByHeadings("## List\n- one\n* two\nnot a bullet\n- three\n");
    const items = extractBulletItems(section);
    expect(items.map((i) => i.text)).toEqual(["one", "two", "three"]);
  });

  it("respects a maxItems bound", () => {
    const [section] = splitByHeadings("## List\n- a\n- b\n- c\n");
    expect(extractBulletItems(section, 2)).toHaveLength(2);
  });

  it("reports a stable line offset for each bullet", () => {
    const [section] = splitByHeadings("## List\n- a\n- b\n");
    const items = extractBulletItems(section);
    expect(items[0].lineOffset).toBe(1);
    expect(items[1].lineOffset).toBe(2);
  });
});

describe("findLabeledSentence", () => {
  it("finds a literal label and returns the first sentence of its paragraph", () => {
    const [section] = splitByHeadings("## Phase\nCurrent phase: Slice X, doing things. More prose after.\n");
    const match = findLabeledSentence(section, "Current phase:");
    expect(match?.text).toBe("Slice X, doing things.");
  });

  it("joins a soft-wrapped paragraph across lines before finding the sentence boundary", () => {
    const [section] = splitByHeadings("## Phase\nCurrent phase: Slice X, doing\nthings across two lines.\n\nNext paragraph.\n");
    const match = findLabeledSentence(section, "Current phase:");
    expect(match?.text).toBe("Slice X, doing things across two lines.");
  });

  it("returns undefined when the label is absent", () => {
    const [section] = splitByHeadings("## Phase\nSome other prose entirely.\n");
    expect(findLabeledSentence(section, "Current phase:")).toBeUndefined();
  });

  it("is case-insensitive on the label", () => {
    const [section] = splitByHeadings("## Phase\ncurrent PHASE: value here.\n");
    expect(findLabeledSentence(section, "Current phase:")?.text).toBe("value here.");
  });
});
