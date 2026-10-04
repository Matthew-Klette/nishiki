/** The eight varieties in the guide. Notes are general reference, written for newcomers. */

export type VarietyId = "kohaku" | "sanke" | "showa" | "tancho" | "utsuri" | "asagi" | "shusui" | "ogon";

export interface Variety {
  readonly id: VarietyId;
  readonly name: string;
  readonly kanji: string;
  readonly reading: string;
  readonly gloss: string;
  readonly lookFor: readonly [string, string, string];
  /** Varieties people most often mistake it for: used for quiz distractors. */
  readonly confusedWith: readonly VarietyId[];
}

export const VARIETIES: readonly Variety[] = [
  {
    id: "kohaku",
    name: "Kohaku",
    kanji: "紅白",
    reading: "kō·haku",
    gloss: "red and white",
    lookFor: [
      "White skin (shiroji) with red (hi) only. No black anywhere.",
      "Red usually starts on the head and stops short of the eyes.",
      "A crisp back edge where red meets white (kiwa).",
    ],
    confusedWith: ["sanke", "tancho"],
  },
  {
    id: "sanke",
    name: "Taishō Sanke",
    kanji: "大正三色",
    reading: "tai·shō san·ke",
    gloss: "three colours of the Taishō era",
    lookFor: [
      "A Kohaku-style red pattern with small black (sumi) islands on top.",
      "No black on the head.",
      "Thin black stripes on the pectoral fins are common.",
    ],
    confusedWith: ["kohaku", "showa"],
  },
  {
    id: "showa",
    name: "Shōwa Sanshoku",
    kanji: "昭和三色",
    reading: "shō·wa san·sho·ku",
    gloss: "three colours of the Shōwa era",
    lookFor: [
      "Black is the base colour; red and white sit over it.",
      "Black reaches the head, often splitting it (menware).",
      "Black at the root of the pectoral fins (motoguro).",
    ],
    confusedWith: ["sanke", "utsuri"],
  },
  {
    id: "tancho",
    name: "Tanchō",
    kanji: "丹頂",
    reading: "tan·chō",
    gloss: "red crown, after the red-crowned crane",
    lookFor: [
      "One red mark, on the head, and no other red on the body.",
      "The rounder and more centred the mark, the more it is prized.",
      "Strictly a pattern: it appears on Kohaku, Sanke and Shōwa lines.",
    ],
    confusedWith: ["kohaku", "sanke"],
  },
  {
    id: "utsuri",
    name: "Shiro Utsuri",
    kanji: "白写り",
    reading: "shi·ro u·tsu·ri",
    gloss: "white reflection",
    lookFor: [
      "Black and white only: no red at all.",
      "Black wraps down the body and onto the head.",
      "Black at the root of the pectoral fins, like Shōwa.",
    ],
    confusedWith: ["showa"],
  },
  {
    id: "asagi",
    name: "Asagi",
    kanji: "浅黄",
    reading: "a·sa·gi",
    gloss: "pale blue-green",
    lookFor: [
      "A blue-grey back covered in a net of pale-edged scales.",
      "Red or orange on the cheeks, the flanks and the fin roots.",
      "One of the oldest varieties; many others descend from it.",
    ],
    confusedWith: ["shusui"],
  },
  {
    id: "shusui",
    name: "Shūsui",
    kanji: "秋翠",
    reading: "shū·su·i",
    gloss: "autumn jade",
    lookFor: [
      "Asagi colours on doitsu (largely scaleless) skin.",
      "Large slate-blue scales in a neat line either side of the dorsal fin, joining at the shoulders.",
      "Broad red down both flanks below a pale sky-blue back.",
    ],
    confusedWith: ["asagi"],
  },
  {
    id: "ogon",
    name: "Ōgon",
    kanji: "黄金",
    reading: "ō·gon",
    gloss: "gold",
    lookFor: [
      "One colour, nose to tail, with a metallic shine.",
      "Each scale edge catches light (fukurin), so the body reads as a net.",
      "Developed in Japan in the 1940s; the root of many metallic lines.",
    ],
    confusedWith: ["asagi", "kohaku"],
  },
];

export function varietyById(id: VarietyId): Variety {
  const found = VARIETIES.find((v) => v.id === id);
  if (!found) throw new Error(`Unknown variety: ${id}`);
  return found;
}
