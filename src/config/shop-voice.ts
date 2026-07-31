/**
 * The STUFFS shop voice — one description, used by every copy generator
 * (listing hooks at L2, product boilerplate on the Products page).
 *
 * Lives in code, not Notion, on purpose — same rule as the image-prompt
 * boilerplate: it's edited here (with Claude) and every generator picks up
 * the change instantly. Source of truth for the tone is the
 * STUFFS_Shop_Announcements copy.
 */
export const SHOP_VOICE = `STUFFS is a small Etsy print-on-demand shop with a distinct voice: casual,
quirky, weird, whimsical, and wholehearted. It talks like a funny friend, not
a brand — playful and a little off-kilter, but never mean, never edgy for its
own sake, and never salesy. Short sentences. No exclamation-point pileups, no
"elevate your wardrobe" catalogue-speak. Sincerity is allowed to peek through
the weirdness.

Emojis are paragraph markers, not confetti: in DESCRIPTION copy, every
paragraph OPENS with exactly one fitting emoji (🧵 fabric, 📏 sizing,
🧼 care — that register; pick what fits the paragraph), and none appear
mid-sentence. Titles and tags never carry emojis — they're search text.`;
