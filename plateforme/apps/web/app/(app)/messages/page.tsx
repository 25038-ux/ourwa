import { apiFetch, requireSession, can } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { Empty } from '@/components/states';
import { ComposeForm } from './forms';

export const dynamic = 'force-dynamic';

interface Sent {
  subject: string;
  sender_name: string;
  sent_at: string;
  recipients: number;
  read_count: number;
}

/**
 * MESSAGERIE PARENTS — `pages/super_admin/messagerie.php` : « (A) un parent
 * ciblé via search (nom OU téléphone), (B) tous les parents d'un niveau +
 * groupe précis, (C) tous les parents d'un niveau ». Le message en tête, puis
 * son unique formulaire. La liste « Envoyés » qui suit est à nous — ce qui est
 * parti et combien de familles l'ont ouvert — décision antérieure, assumée.
 */
export default async function MessagesPage() {
  const { user } = await requireSession();

  // Son `require_staff_admin()`.
  if (!can(user, 'messagerie.envoyer')) {
    return (
      <>
        <PageHeader titre="Messagerie parents" sousTitre="Cibler un parent par recherche OU diffuser par niveau/groupe" />
        <div className="form-card">
          <p className="text-muted">Cette page demande la permission <code>messagerie.envoyer</code>.</p>
        </div>
      </>
    );
  }

  const [sent, year, niveaux, groupes] = await Promise.all([
    apiFetch<Sent[]>('/messages').catch(() => [] as Sent[]),
    anneeAffichee(),
    apiFetch<{ id: string; name: string }[]>('/levels').catch(() => []),
    apiFetch<{ id: string; name: string; level_id: string | null }[]>('/groups').catch(() => []),
  ]);

  return (
    <>
      <PageHeader titre="Messagerie parents" sousTitre="Cibler un parent par recherche OU diffuser par niveau/groupe" />
      <MessagePage>
        <ComposeForm
          niveaux={niveaux}
          groupes={groupes.map((g) => ({ id: g.id, name: g.name, levelId: g.level_id }))}
          academicYearId={year?.id ?? null}
        />

        {/* « ENVOYÉS » EST À NOUS, ET IL RESTE — décision assumée. `messagerie.php`
            n'a qu'une seule section. Ce panneau ne fait qu'AJOUTER une lecture :
            ce qui est parti, à combien de familles, et combien l'ont ouvert. Un
            message ne se rappelle pas : sans lui, l'école envoie et n'a aucun
            moyen de savoir si quiconque a lu. */}
        <section className="table-container" style={{ marginTop: '1.5rem' }}>
          <div className="table-header">
            <h3>Envoyés</h3>
            {sent.length > 0 && <span className="badge badge-primary">{sent.length}</span>}
          </div>
          <div className="panel-body">
            {sent.length === 0 ? (
              <Empty mark="✉️" title="Rien n'a encore été envoyé">
                Le premier message apparaîtra ici, avec le nombre de familles qui l&apos;ont ouvert.
              </Empty>
            ) : (
              <ol className="thread">
                {sent.map((m) => (
                  <li key={`${m.sent_at}-${m.subject}`}>
                    <div className="thread-head">
                      <strong>{m.subject}</strong>
                      <span className="text-muted micro">
                        {new Date(m.sent_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-muted micro">
                      {m.sender_name} · {m.recipients} destinataire{m.recipients > 1 ? 's' : ''}
                    </p>
                    <div className="gauge" role="img" aria-label={`${m.read_count} sur ${m.recipients} ouverts`}>
                      <span style={{ inlineSize: `${m.recipients ? (m.read_count / m.recipients) * 100 : 0}%` }} />
                    </div>
                    <span className="text-muted micro">{m.read_count} ouvert{m.read_count > 1 ? 's' : ''}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </MessagePage>
    </>
  );
}
