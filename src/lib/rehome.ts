/**
 * Moving photographs that are still inside the diary out of it.
 *
 * Anybody who logged a photographed meal before photos.ts existed has a
 * full-size image sitting in localStorage, and enough of them is what made
 * the app unable to save at all — seventeen filled the five megabytes a
 * browser gives, and the eighteenth would not write.
 *
 * Kept apart from photos.ts, and given its shrinking and its saving rather
 * than importing them, for two reasons. The decisions here — which photographs
 * count as oversized, what happens to one that will not convert — are the part
 * worth testing, and they can be tested under `node --test`, where there is no
 * IndexedDB and no canvas to be had. It also keeps the store's dependencies
 * honest: this module touches no browser API at all.
 */

/**
 * Bigger than any thumbnail we make, far smaller than any photograph.
 *
 * Measured: thumbnails come out around 5 KB, photographs around 300 KB. There
 * is no near miss to worry about between those two.
 */
const BIG = 40_000;

export const isOversized = (photo: string | undefined): boolean => Boolean(photo && photo.length > BIG);

export async function rehomePhotos(
  meals: { id: string; photo?: string }[],
  thumbnail: (dataUrl: string) => Promise<string>,
  save: (id: string, dataUrl: string) => Promise<void>,
): Promise<Record<string, string>> {
  const moved: Record<string, string> = {};

  for (const meal of meals) {
    if (!isOversized(meal.photo)) continue;
    try {
      const thumb = await thumbnail(meal.photo!);
      await save(meal.id, meal.photo!);
      moved[meal.id] = thumb;
    } catch {
      // Left exactly as it was. A photograph that will not convert is still a
      // photograph, and dropping it to save a few kilobytes is not this
      // function's call to make.
    }
  }

  return moved;
}
