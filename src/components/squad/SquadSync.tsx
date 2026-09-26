import { useEffect, useRef } from 'react';
import { useToast } from '../ui';
import { useStanding, useSubscribed } from '../useSubscribed';
import { useSquish } from '../../store/useSquish';
import { wearable } from '../../lib/outfit';
import { cheerById } from '../../lib/cheers';
import { clearCheerInbox, cheersSeen, forgetSquad, keepCheers, postStatus, refreshSquad, statusFrom } from '../../lib/squad';
import { useSquad } from './useSquad';

/**
 * Keeps this person's squad in step, from wherever they are in the app:
 * asks once they are signed in, shares their little status when it changes,
 * and says each cheer that has arrived — once — then marks it read.
 *
 * Renders nothing.
 */
export default function SquadSync() {
  const standing = useStanding();
  const subscribed = useSubscribed();
  const squad = useSquad();
  const toast = useToast();
  const meals = useSquish((s) => s.meals);
  const unlocked = useSquish((s) => s.unlocked);
  const look = useSquish((s) => s.look);
  const outfit = useSquish((s) => s.outfit);
  const unlock = useSquish((s) => s.unlock);

  // Signed in: find out whether they are in a squad. Signed out: forget it.
  useEffect(() => {
    if (!standing.known) return;
    if (standing.account && !standing.off) void refreshSquad();
    else {
      forgetSquad();
      clearCheerInbox();
    }
  }, [standing.known, standing.account, standing.off]);

  // Coming back to the app is the likeliest moment for news from the squad.
  useEffect(() => {
    if (!standing.account) return;
    const onShow = () => document.visibilityState === 'visible' && void refreshSquad();
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [standing.account]);

  // What they share, whenever it changes — and only what the squad sees:
  // Squish in what they may wear today, not in something they chose and lost.
  const inSquad = squad.kind === 'in';
  const status = statusFrom(meals, unlocked, look, wearable(outfit, { unlocked, subscribed, today: new Date() }));
  const key = JSON.stringify(status);
  const sent = useRef('');
  useEffect(() => {
    if (!inSquad || sent.current === key) return;
    const timer = window.setTimeout(() => {
      sent.current = key;
      void postStatus(JSON.parse(key));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [inSquad, key]);

  // Cheers that have arrived: said once each, then marked read.
  const said = useRef(new Set<string>());
  useEffect(() => {
    if (squad.kind !== 'in') return;
    const fresh = squad.squad.cheers.filter((c) => !said.current.has(c.id));
    if (!fresh.length) return;
    for (const c of fresh.slice(0, 3)) {
      said.current.add(c.id);
      const cheer = cheerById(c.cheer);
      if (cheer) toast(`${c.from}: ${cheer.words}`, cheer.emoji);
    }
    if (fresh.length > 3) toast(`…and ${fresh.length - 3} more cheers from your squad`, '💜');
    for (const c of fresh) said.current.add(c.id);
    // Kept for today on this phone, so Home can bring the squad up to show them.
    keepCheers(fresh.map((c) => ({ id: c.id, from: c.from, cheer: c.cheer })));
    void cheersSeen(fresh.map((c) => c.id));
  }, [squad, toast]);

  // A week the whole squad hit its goal is worth a badge.
  useEffect(() => {
    if (squad.kind === 'in' && squad.squad.weeksWon > 0) unlock('squad-week');
  }, [squad, unlock]);

  return null;
}
