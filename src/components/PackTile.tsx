import Squish from './Squish';
import { sceneUrl } from './sceneArt';
import type { PackContents } from '../lib/packs';
import { plural, t } from '../lib/i18n';

/**
 * A pack as one thing: Squish wearing it (in front of its scene, if it has
 * one), the pack's name, and what is in it. Shared by the wardrobe and the
 * scene picker, so the Cosy pack looks the same from either.
 */
export default function PackTile({ contents, dark, onTap }: { contents: PackContents; dark: boolean; onTap: () => void }) {
  const scene = contents.scenes[0];
  const backdrop = scene ? sceneUrl(scene.id, dark ? 'dark' : 'light') : undefined;
  return (
    <button type="button" className="pack-tile look--locked" onClick={onTap} aria-label={t('{pack}: {contents}. Not on sale yet.', { pack: contents.name, contents: contents.words })}>
      <span className="pack-preview" aria-hidden="true">
        {backdrop && <img className="pack-backdrop" src={backdrop} alt="" />}
        <Squish mood="excited" size={64} bob={false} outfit={contents.look} className="look-preview" label="" />
      </span>
      <span className="pack-text">
        <span className="tile-name">{contents.name}</span>
        <span className="pack-words">{contents.words}</span>
        <span className="tile-note">
          {plural(contents.count, { one: '{n} item · coming soon', other: '{n} items · coming soon' })}
        </span>
      </span>
    </button>
  );
}
