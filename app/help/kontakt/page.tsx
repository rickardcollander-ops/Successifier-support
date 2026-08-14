import type { Metadata } from 'next';
import { product } from '@/lib/products';
import { getTenantId } from '@/lib/products/tenant';
import { getHelpCenterConfig, DEFAULT_HELP_CENTER } from '@/lib/services/help-center';
import ContactForm from '@/components/help/ContactForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Kontakta oss – ${product.displayName}`,
  description: `Ställ din fråga till ${product.brandName} och få svar direkt av vår AI-assistent — eller skicka den vidare till kundservice.`,
};

// The AI contact form. The customer's question is answered instantly from
// the knowledge base; only unanswered questions become tickets. When the
// operator has turned the chatbot off, the page degrades to a plain form.
export default async function ContactPage() {
  const tenantId = await getTenantId();
  const config = tenantId ? await getHelpCenterConfig(tenantId) : DEFAULT_HELP_CENTER;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="text-center space-y-3">
        <h1 className="text-3xl font-bold">Kontakta oss</h1>
        <p className="text-[color:var(--kb-muted)]">
          {config.chatEnabled
            ? 'Ställ din fråga så svarar vår AI-assistent direkt. Löser det inte problemet skickas din fråga vidare till kundservice med ett klick.'
            : 'Skicka din fråga till kundservice så återkommer vi via e-post så snart som möjligt.'}
        </p>
      </section>
      <ContactForm aiEnabled={config.chatEnabled} />
    </div>
  );
}
