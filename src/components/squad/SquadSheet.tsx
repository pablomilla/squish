import { useState } from 'react';
import Squish from '../Squish';
import { Sheet, useToast } from '../ui';
import { CHEERS, SQUAD_MAX } from '../../lib/cheers';
import { blockInSquad, leaveSquad, loggedToday, memberMood, renameInSquad, sendCheer, type Squad, type SquadMember } from '../../lib/squad';
import { isoDate } from '../../lib/date';
import type { Outfit } from '../../lib/outfit';
import './squad.css';
import { t } from '../../lib/i18n';
import { richPlural } from '../../lib/i18n-react';

export function MemberSquish({ member, size = 52 }: { member: SquadMember; size?: number }) {
  return (
    <Squish
      mood={memberMood(member)}
      size={size}
      bob={false}
      look={member.look ?? 'squish'}
      outfit={member.outfit as Outfit}
      label={t("{name}'s Squish", { name: member.name })}
    />
  );
}

/**
 * The squad up close: everybody's day and week, a cheer for each, the way to
 * bring friends in, and — for when it is needed — leaving and blocking.
 */
export default function SquadSheet({ squad, open, onClose }: { squad: Squad; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [cheering, setCheering] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'leave' } | { kind: 'block'; member: SquadMember } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const today = isoDate();
  const me = squad.members.find((m) => m.isMe);
  const others = squad.members.filter((m) => !m.isMe);
  const onTrack = squad.members.filter((m) => m.weekDays >= squad.goal).length;
  const wonThisWeek = me?.weekKey && squad.lastWonWeek === me.weekKey;

  const cheer = async (member: SquadMember, id: string) => {
    const done = await sendCheer(member.id, id);
    if (!done.ok) {
      toast(done.message, '💜');
      return;
    }
    const sent = CHEERS.find((c) => c.id === id)!;
    toast(t('Sent {name} “{cheer}”', { name: member.name, cheer: sent.words }), sent.emoji);
    setCheering(null);
  };

  const invite = async () => {
    const text = t('Join my Squish squad, {squad}! We cheer each other on. Code {code}:', { squad: t(squad.name), code: squad.code });
    try {
      if (navigator.share) {
        await navigator.share({ title: t('Squish squad'), text, url: squad.link });
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(`${text} ${squad.link}`);
      toast(t('Squad link copied — paste it to a friend'), '🔗');
    } catch {
      toast(t('Squad code: {code}', { code: squad.code }), '🔗');
    }
  };

  const sentAlready = (member: SquadMember, id: string) => squad.sentToday.some((s) => s.to === member.id && s.cheer === id);

  return (
    <Sheet open={open} onClose={onClose} title={t(squad.name)}>
      <div className="squad-sheet">
        <div className="squad-goal">
          <p className="small">
            {wonThisWeek
              ? t('🏆 Everybody hit {goal} days this week. Squad goals!', { goal: squad.goal })
              : t('This week, everybody aims to log on {goal} days — {done} of {total} there so far.', { goal: squad.goal, done: onTrack, total: squad.members.length })}
          </p>
          {squad.weeksWon > 0 && <p className="tiny muted">{t('Weeks the whole squad made it: {n}', { n: squad.weeksWon })}</p>}
        </div>

        <ul className="squad-members">
          {squad.members.map((member) => (
            <li key={member.id} className="squad-member">
              <div className="squad-member-row">
                <MemberSquish member={member} />
                <div className="squad-member-text">
                  <p className="small">
                    <b>{member.name}</b>
                    {member.isMe ? ` ${t('(you)')}` : ''}
                  </p>
                  <p className="tiny muted">
                    {loggedToday(member, today) ? t('✓ Logged today') : t('Not yet today')} · 🔥 {member.streak} ·{' '}
                    {t('{done}/{goal} this week', { done: Math.min(member.weekDays, 7), goal: squad.goal })}
                    {member.badges.length ? ` · 🏅 ${member.badges.length}` : ''}
                  </p>
                </div>
                {!member.isMe && (
                  <button type="button" className="btn btn--sm btn--soft" onClick={() => setCheering(cheering === member.id ? null : member.id)}>
                    {t('Cheer')}
                  </button>
                )}
              </div>
              {cheering === member.id && (
                <div className="cheer-grid" role="group" aria-label={t('Cheers for {name}', { name: member.name })}>
                  {CHEERS.map((c) => {
                    const done = sentAlready(member, c.id);
                    return (
                      <button key={c.id} type="button" className="cheer" disabled={done} onClick={() => void cheer(member, c.id)}>
                        <span aria-hidden="true">{c.emoji}</span> {c.words}
                        {done && <span className="tiny muted"> · {t('sent')}</span>}
                      </button>
                    );
                  })}
                  <button type="button" className="linkish tiny squad-block-link" onClick={() => setConfirm({ kind: 'block', member })}>
                    {t('Block {name}', { name: member.name })}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {others.length === 0 && <p className="small muted">{t('Nobody else here yet. Send your squad link to a friend or two.')}</p>}

        {squad.members.length < SQUAD_MAX && (
          <div className="squad-invite">
            <p className="small">
              {richPlural(SQUAD_MAX - squad.members.length, { one: 'Invite friends — {n} place left. Code <b>{code}</b>', other: 'Invite friends — {n} places left. Code <b>{code}</b>' }, { code: squad.code }, { b: (text) => <b className="mono">{text}</b> })}
            </p>
            <button type="button" className="btn btn--block" onClick={() => void invite()}>
              {t('Send the squad link')}
            </button>
          </div>
        )}

        <div className="squad-me">
          {renaming === null ? (
            <p className="tiny muted">
              {t('You are “{name}” here.', { name: me?.name ?? '' })}{' '}
              <button type="button" className="linkish tiny" onClick={() => setRenaming(me?.name ?? '')}>
                {t('Change')}
              </button>
            </p>
          ) : (
            <form
              className="squad-rename"
              onSubmit={(event) => {
                event.preventDefault();
                void renameInSquad(renaming).then((done) => {
                  if (!done.ok) toast(done.message, '✏️');
                  else setRenaming(null);
                });
              }}
            >
              <input aria-label={t('Your name in the squad')} value={renaming} maxLength={20} onChange={(event) => setRenaming(event.target.value)} />
              <button type="submit" className="btn btn--sm">
                {t('Save')}
              </button>
            </form>
          )}
          <p className="tiny muted">
            {t('Your squad sees your first name, streak, whether you logged today, your days this week, your badges and your Squish. Never your food or your weight.')}
          </p>
          <button type="button" className="btn btn--sm btn--quiet-danger" onClick={() => setConfirm({ kind: 'leave' })}>
            {t('Leave the squad')}
          </button>
        </div>

        {confirm && (
          <div className="squad-confirm" role="alertdialog" aria-label={t('Are you sure?')}>
            <p className="small">
              {confirm.kind === 'leave'
                ? t('Leave the squad? You can join again with the code, if there is room.')
                : t("Block {name}? You will not see each other or each other's cheers again, in any squad. They are not told.", { name: confirm.member.name })}
            </p>
            <div className="squad-confirm-actions">
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm(null)}>
                {t('Cancel')}
              </button>
              <button
                type="button"
                className="btn btn--sm btn--danger"
                onClick={() => {
                  const run = confirm.kind === 'leave' ? leaveSquad() : blockInSquad(confirm.member.id);
                  void run.then((done) => {
                    if (!done.ok) toast(done.message, '💜');
                    else toast(confirm.kind === 'leave' ? t('You have left the squad.') : t('{name} is blocked.', { name: confirm.member.name }), '👋');
                    setConfirm(null);
                    setCheering(null);
                    if (confirm.kind === 'leave') onClose();
                  });
                }}
              >
                {confirm.kind === 'leave' ? t('Leave') : t('Block')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
