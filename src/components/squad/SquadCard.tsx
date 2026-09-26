import { useState } from 'react';
import { askForAccount } from '../../lib/account';
import { pendingSquadInvite } from '../../lib/squad';
import { useStanding } from '../useSubscribed';
import { useSquad } from './useSquad';
import SquadSheet from './SquadSheet';
import SquadForms from './SquadForms';
import './squad.css';
import { t } from '../../lib/i18n';
import { listWords } from '../../lib/packs';

/** On You: what a squad is, and the way to start or join one — or into yours. */
export default function SquadCard() {
  const squad = useSquad();
  const standing = useStanding();
  const [form, setForm] = useState<'start' | 'join' | null>(null);
  const [open, setOpen] = useState(false);

  if (!standing.known || standing.off) return null;

  return (
    <section className="card squad-card">
      <div className="card-title">
        <h3>{t('Your squad')}</h3>
        {squad.kind === 'in' && <span className="badge">{t('{n} of {max}', { n: squad.squad.members.length, max: 5 })}</span>}
      </div>
      {squad.kind === 'in' ? (
        <>
          <p className="small">
            <b>{t(squad.squad.name)}</b> — {listWords(squad.squad.members.map((m) => (m.isMe ? t('you') : m.name)))}.
          </p>
          <div className="squad-card-actions">
            <button type="button" className="btn btn--sm" onClick={() => setOpen(true)}>
              {t('Open your squad')}
            </button>
          </div>
          <SquadSheet squad={squad.squad} open={open} onClose={() => setOpen(false)} />
        </>
      ) : (
        <>
          <p className="small">{t('Up to five friends who cheer each other on.')}</p>
          <p className="tiny muted">
            {t("See who has logged today and how everybody's week is going, send a cheer, and aim for a week you all hit together. No messages, no food and no weight — just encouragement.")}
          </p>
          {standing.account ? (
            <div className="squad-card-actions">
              <button type="button" className="btn btn--sm" onClick={() => setForm('start')}>
                {t('Start a squad')}
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setForm('join')}>
                {t('Join with a code')}
              </button>
            </div>
          ) : (
            <div className="squad-card-actions">
              <button type="button" className="btn btn--sm btn--soft" onClick={() => askForAccount()}>
                {t('Make an account to join a squad')}
              </button>
            </div>
          )}
          <SquadForms key={`${form}-${pendingSquadInvite() ?? ''}`} mode={form} code={pendingSquadInvite() ?? ''} onClose={() => setForm(null)} />
        </>
      )}
    </section>
  );
}
