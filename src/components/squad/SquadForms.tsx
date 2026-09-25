import { useState } from 'react';
import { Sheet, useToast } from '../ui';
import { SQUAD_NAMES, tidyDisplayName } from '../../lib/cheers';
import { forgetSquadInvite, joinSquad, startSquad } from '../../lib/squad';
import { useSquish } from '../../store/useSquish';
import './squad.css';

/** The first word of their name, if it is a name at all: a starting point they can change. */
const firstName = (name: string | undefined) => tidyDisplayName((name ?? '').split(' ')[0] ?? '') ?? '';

/**
 * Starting a squad (name picked from the list) or joining one (with a code),
 * and the first name the others will see. Nothing else is asked.
 */
export default function SquadForms({
  mode,
  code: initialCode = '',
  onClose,
}: {
  mode: 'start' | 'join' | null;
  code?: string;
  onClose: () => void;
}) {
  const profileName = useSquish((s) => s.profile.name);
  const toast = useToast();
  const [name, setName] = useState<string>(SQUAD_NAMES[0]);
  const [me, setMe] = useState(firstName(profileName));
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    if (!tidyDisplayName(me)) {
      setProblem('Your name can be letters, spaces, hyphens and apostrophes, up to 20.');
      return;
    }
    setBusy(true);
    setProblem(null);
    const done = mode === 'start' ? await startSquad(name, me) : await joinSquad(code, me);
    setBusy(false);
    if (!done.ok) {
      setProblem(done.message);
      return;
    }
    forgetSquadInvite();
    toast(mode === 'start' ? `${name} is ready — send the link to a friend or two` : `You're in ${done.squad?.name ?? 'the squad'}!`, '💜');
    onClose();
  };

  return (
    <Sheet open={mode !== null} onClose={onClose} title={mode === 'start' ? 'Start a squad' : 'Join a squad'}>
      <form
        className="squad-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {mode === 'start' ? (
          <>
            <label>Pick a name for the squad</label>
            <div className="squad-names" role="radiogroup" aria-label="Squad name">
              {SQUAD_NAMES.map((option) => (
                <button key={option} type="button" className="squad-name-chip" aria-pressed={name === option} onClick={() => setName(option)}>
                  {option}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <label htmlFor="squad-code">Squad code</label>
            <input id="squad-code" value={code} autoCapitalize="characters" autoComplete="off" onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="e.g. K7M2PQA" />
          </>
        )}
        <label htmlFor="squad-me">Your first name, as the squad will see it</label>
        <input id="squad-me" value={me} maxLength={20} onChange={(event) => setMe(event.target.value)} autoComplete="given-name" />
        <p className="tiny muted">
          The squad sees your first name, streak, whether you logged today, your days this week, your badges and your Squish. Never your
          food or your weight.
        </p>
        {problem && <p className="small" style={{ color: 'var(--bad)', margin: 0 }}>{problem}</p>}
        <button type="submit" className="btn btn--block" disabled={busy || (mode === 'join' && code.trim().length < 5)}>
          {mode === 'start' ? 'Start the squad' : 'Join'}
        </button>
      </form>
    </Sheet>
  );
}
