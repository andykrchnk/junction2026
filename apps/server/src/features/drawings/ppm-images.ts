import sharp from 'sharp';

type PpmPage = Readonly<{ page: number; width: number; height: number; bytes: Buffer }>;

// Keep the full sheet for context; overlapping enlarged strips expose small labels and dimension arrows.
export async function ppmDetailImages(params: Readonly<{ pages: ReadonlyArray<PpmPage> }>) {
    return Promise.all(
        params.pages.flatMap((page) => {
            const height = Math.ceil(page.height / 2);
            return [0, Math.floor(page.height / 4), page.height - height].map(async (top) => ({
                page: page.page,
                cropBounds: { left: 0, top, width: page.width, height },
                bytes: await sharp(page.bytes)
                    .extract({ left: 0, top, width: page.width, height })
                    .resize({ width: Math.min(1800, Math.max(1200, page.width)) })
                    .png()
                    .toBuffer(),
            }));
        }),
    );
}

export const openingNotationInstructions = `Finnish drawing convention may be used as an explicitly inferred hypothesis, not a verified measurement: I is a window prefix (ikkuna), O a door prefix; distinguish letter I from numeral 1. I15x12 usually denotes nominal modular width 15M and height 12M, where 1M=100 mm: 1500 x 1200 mm, NOT 115 x 12 cm. Nominal modular size is not an exact measured frame or construction hole size. Preserve the actual raw reading separately; if I/1 or digits remain ambiguous, state alternatives rather than silently correcting them. For scale use the plan-visible width only, never the window height. Convention-based millimetres for unlabelled architectural dimensions are permitted when supported by drawing context and cross-checks; mark unitBasis convention and explain the inferred units. Do not mistake ordinary door callouts, room numbers or window type codes for dimensions.`;
