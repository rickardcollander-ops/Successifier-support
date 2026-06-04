-- Serus: skapa tenant + ladda FAQ/kunskapsbas.
-- Klistra in HELA filen i Neon → SQL Editor (Serus-databasen) och kör.
-- Kräver att tabellerna finns (dvs efter första lyckade Vercel-deployen som kör prisma migrate deploy).
-- Idempotent: går att köra om utan dubbletter.

BEGIN;

-- 1) Tenant-raden (id == subdomain == produktnyckel)
INSERT INTO "Tenant" (id, subdomain, name, "createdAt", "updatedAt")
VALUES ('serus', 'serus', 'Serus', now(), now())
ON CONFLICT (subdomain) DO NOTHING;

-- 2) FAQ/kunskapsbas-artiklar
INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'What is Serus?', 'Serus is your AI privacy assistant — built to help you regain control of your personal information online. Serus scans both the surface web and the dark web to map where your personal information appears, combining agentic search intelligence with OSINT to surface profiles, reposts, leaks and mentions across the open web, then organizes it into one clear dashboard.

Serus was founded in Sweden and grew out of frustration with invasive data collection. The team previously launched DoldAdress.se, which helped tens of thousands of Swedes remove personal information from search engines and people-search sites. Serus is backed by pre-seed and seed funding and is led by Filip Landgren (CEO & Co-Founder) and Anthon Wansland (Head of Product & Co-Founder), supported by a team of engineers, designers and legal specialists.', 'About', ARRAY['about','company','product']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'What is Serus?');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'Pricing and plans', 'Serus has three plans:

- Free — $0/month. Includes protection, 5 data removal requests/day, a limited Serus AI assistant, dark web and surface web surveillance, limited footprint improvements, limited alerts & monitoring, and Intelligence Tools with 0 monthly credits.
- Pro — $12/month. Includes protection, unlimited data removals, full Serus AI assistant, dark web and surface web surveillance, footprint improvements, real-time alerts & monitoring, and Intelligence Tools with 500 monthly credits.
- Premium — $19/month. Same as Pro, plus Autopilot (automated removals) and Intelligence Tools with 2,500 monthly credits.

Billing: 70% off the first month, a 30-day money-back guarantee, and you can cancel anytime — no lock-ins. Business pricing is available via the sales/contact page.', 'Pricing', ARRAY['pricing','plans','billing','refund']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'Pricing and plans');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'How Serus finds your exposed information', 'Serus scans both the surface web and the dark web to map where your personal information appears online. It combines agentic search intelligence with OSINT (open-source intelligence) to surface profiles, reposts, leaks and mentions across the open web, then organizes everything into one clear view so you can see your exposure and act on it.', 'How it works', ARRAY['scan','dark web','osint','exposure']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'How Serus finds your exposed information');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'How we handle your data (security & privacy)', 'Your data is protected with strong security controls:

- Encryption at rest: all datastores are encrypted, and sensitive data has additional app-level encryption.
- Encryption in transit: Serus uses TLS 1.3 or higher to encrypt every transmission.
- Backups: Serus keeps point-in-time backups of all data via its hosting provider.
- Access controls: unique authentication, restricted encryption keys and strict access controls protect the infrastructure.
- Privacy controls: clear data retention, deletion when you leave, and data classification policies keep you in control of your information.', 'Security & privacy', ARRAY['security','privacy','data','encryption','retention','deletion']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'How we handle your data (security & privacy)');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'Autopilot: automated data removals', 'Autopilot continuously scans data broker sites and automatically submits removal requests on your behalf, handling the tedious work of tracking down and removing your personal information. You typically see noticeable results within 30-60 days.

When setting up, you can tailor the scope: focus only on data brokers, only on surface-web search results, or choose comprehensive coverage across all identified exposures. The Requests section lets you track submission dates, processing timelines and completion status for each removal.

Autopilot is available on the Premium plan; it is not included in the Free or Pro plans. To activate it, go to Settings > Subscription > Upgrade to Premium. Getting started requires an account via Google or email, after which Serus handles removals automatically and continuously.', 'How it works', ARRAY['autopilot','removals','data brokers','requests']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'Autopilot: automated data removals');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'How to remove search results about you from Google', 'Steps to remove search results about you from Google:

1. Choose the right form. EU citizens: use Google''s legal troubleshooter (Google Search → Legal Reasons → Personal Data/Privacy → Right to be forgotten). Non-EU residents: use Google''s content removal form directly.
2. Identify the unwanted links. Search your name in different combinations (full name, with middle name, name + address) and confirm the results are actually about you, focusing on pages showing personal details like address, phone, or email.
3. Collect the URLs. Copy the full URL of each problematic result into one document to avoid duplicates.
4. Submit your request with the required details.
5. Expect processing time: links are removed in about 13 days on average (some in ~4 days, others up to 8 weeks).

Note: personal addresses and photos are usually removable, but "public interest" content — official records, business information and news of broader importance — generally cannot be removed.', 'Guides', ARRAY['google','search results','removal','right to be forgotten']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'How to remove search results about you from Google');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'Helpful guides on the Serus blog', 'More in-depth guides are available on the Serus blog (https://www.serus.ai/blog):

- Using Autopilot: https://www.serus.ai/blog/using-autopilot
- How to Remove Search Results About You from Google: https://www.serus.ai/blog/how-to-remove-search-results-from-google
- Guide: How to Delete Yourself from the Internet: https://www.serus.ai/blog/how-to-delete-yourself-from-the-internet
- How to Get My Information Off the Dark Web: https://www.serus.ai/blog/how-to-get-my-information-off-the-dark-web
- What Happens If Your Email Is on the Dark Web: https://www.serus.ai/blog/what-happens-if-your-email-is-on-the-dark-web
- How to Protect Your Digital Footprint – 10 Easy Ways: https://www.serus.ai/blog/how-to-protect-your-digital-footprint-–-10-easy-ways
- How to Protect Yourself and Your Data from Internet Hackers: https://www.serus.ai/blog/how-to-protect-my-data-from-hackers
- How to Prevent Data Breaches in 8 Ways: https://www.serus.ai/blog/how-to-prevent-data-breaches
- Understand the Different Types of Exposure: https://www.serus.ai/blog/understand-your-exposure
- Dark Web Definition: What is It and How Does it Work?: https://www.serus.ai/blog/dark-web-definition
- How to Know if Your Phone Is Hacked – 10 Signs: https://www.serus.ai/blog/how-to-know-if-your-phone-is-hacked', 'Guides', ARRAY['blog','guides','links']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'Helpful guides on the Serus blog');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'How can Serus find so much information?', 'Serus scans both the surface web and dark web to map where your personal information appears online. We combine agentic search intelligence with OSINT to surface profiles, reposts, leaks, and mentions across the open web — then organize it into one clear view.', 'FAQ', ARRAY['faq','search','osint']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'How can Serus find so much information?');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'Does Serus track a reputation Score?', 'Yes. Serus compiles a reputation score for you and every member of your team. By scanning online mentions, public records, and your broader digital footprint, it aggregates everything into a comprehensive reputation profile — then distills it into a single score that reflects how you and your team are perceived online.', 'FAQ', ARRAY['faq','reputation score']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'Does Serus track a reputation Score?');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'Is my data safe?', 'Yes. Your data is encrypted in transit and at rest, and handled in accordance with applicable laws. We never expose or share information from our user database, your searches don''t reveal other users'' data. We only collect what''s necessary to run monitoring and removal requests, and we keep access tightly controlled with minimal retention. We never sell your information—ever.', 'FAQ', ARRAY['faq','security','privacy','data']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'Is my data safe?');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'What intelligence tools do you offer?', 'Serus provides curated API solutions and intelligence accounts tailored to your organization''s needs. Each account comes topped up with credits that are shared across all members of your organization, giving your team flexible access to the tools they need without managing individual subscriptions.', 'FAQ', ARRAY['faq','intelligence tools','credits']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'What intelligence tools do you offer?');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'Are there limits to what you can find?', 'If it exists on the internet, we will most likely find it. Serus scans across the surface web, indexed data sources, the dark web, data broker databases, and runs broad OSINT scans to identify potential exposures wherever they may appear. Our coverage is designed to be as comprehensive as possible, leaving very few blind spots.', 'FAQ', ARRAY['faq','coverage','search']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'Are there limits to what you can find?');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'What type of information do you protect?', 'Serus gives you control through visibility. Exposure is inevitable — our goal is to make sure you see it first, before attackers do. We monitor and protect all the details your organization signs up with, from your domains and keywords to the individual names of your employees. The more detail you provide, the more thorough your coverage becomes.', 'FAQ', ARRAY['faq','protection','monitoring']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'What type of information do you protect?');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'How do I sign up my organization?', 'Getting started is straightforward. Contact our sales team to request a demo, and we''ll walk you through the full setup process. From there, onboarding is quick and easy, and your organization can be up and running in no time.', 'FAQ', ARRAY['faq','signup','organization','sales']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'How do I sign up my organization?');

-- 3) Supportbaserade FAQ-artiklar (vanliga kundärenden)
INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'How to delete your account and personal data', 'To delete your account and permanently remove all associated personal data, follow these steps:

1. Log in to your Serus account.
2. Go to Settings.
3. Select Delete Account and follow the prompts to confirm.

Please note that this action is permanent and cannot be undone. For a more detailed step-by-step guide, see https://www.serus.ai/contact/support/delete-account

Once the request has been processed, your account and all associated personal data are permanently deleted from our servers.', 'Account', ARRAY['account','delete','data deletion','gdpr','unsubscribe']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'How to delete your account and personal data');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'How to stop emails and manage notification preferences', 'You can manage your email preferences directly within your account. Go to Settings > Notifications, where you can toggle off specific alerts or unsubscribe from all notifications entirely.', 'Account', ARRAY['notifications','email','unsubscribe','alerts','preferences']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'How to stop emails and manage notification preferences');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'Charged after cancelling your subscription', 'When you cancel a subscription, it stays active until the end of your current billing period, and the cancellation takes effect from its scheduled date. If a payment falls due before that scheduled cancellation date, the system may automatically attempt to process it.

If you were charged, or see a pending charge, after cancelling, contact support. We can look into your account, manually end your plan immediately, and cancel any pending charge so that no payment is taken.', 'Billing', ARRAY['billing','subscription','cancellation','refund','charge']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'Charged after cancelling your subscription');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'How to view and edit your account details (name & surveilled information)', 'To view or edit the information linked to your account, go to Settings and select the "Your Surveilled Information" section. From there you can update the relevant details — for example your first name, middle name or surname — and save the changes.

If you can''t find this section, reply to support and we''ll be happy to guide you further.', 'Account', ARRAY['account','settings','profile','name','surname','edit']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'How to view and edit your account details (name & surveilled information)');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'Can I change the email address on my account?', 'At this time it is not possible to change the email address associated with an existing account. To use a different email address, you would need to delete your current account and create a new one using your preferred email address.

We appreciate this feedback and have shared the ability to update email addresses on existing accounts with our team for future consideration.', 'Account', ARRAY['account','email','change email']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'Can I change the email address on my account?');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'Why does Serus need my home address?', 'Serus uses your home address only to accurately match and locate the online sources that currently hold your data, ensuring we don''t accidentally request the removal of someone else''s profile with a similar name.

If you don''t feel comfortable providing it, that''s completely fine — you can choose to skip it, and we''ll still do our best to help you with the information you have provided.', 'Security & privacy', ARRAY['privacy','home address','matching','data']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'Why does Serus need my home address?');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'What is an exposure, and what do the categories mean?', 'An exposure means Serus has found your personal information in a place where it shouldn''t be, or where it might pose a risk to your privacy. Think of it as a digital footprint that could make you vulnerable to things like spam, unwanted tracking, or identity theft.

Exposures are grouped into four main areas on your dashboard:

- Data Brokers: companies that collect and sell your personal details (like your name, address, or phone number).
- Dark Web Breaches: leaked databases from hacked websites where your credentials (like emails or passwords) might have appeared.
- Surface Web: public mentions of your information on regular websites or search results.
- Compromised Accounts: specific online accounts that show signs of security risks or unauthorized access.

Log in to your dashboard to review the specific findings, see exactly what information was found, and take the steps needed to secure or remove it.', 'FAQ', ARRAY['faq','exposure','dashboard','data brokers','dark web']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'What is an exposure, and what do the categories mean?');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'How to check if your information was breached, and what to do', 'To check whether any of your email addresses or contact details have appeared in a known data breach, use the Dark Web Scan feature in the Investigate tab. For ongoing protection, add your details to our monitoring service so you''re notified immediately as soon as we detect any new breach involving your information.

If a breach is found, we recommend the following steps to help contain and prevent further harm:

- Change compromised passwords immediately, especially if they were reused across multiple services.
- Delete accounts on services you no longer use or recognize.
- Review the exposed data carefully — we show exactly what information was involved (e.g. email, password, phone number).
- If a stealer log is detected, this may indicate malware on your device; run a full antivirus/anti-malware scan to remove any threats.

Taking these steps quickly can significantly reduce the risk of further damage.', 'Guides', ARRAY['breach','dark web scan','monitoring','passwords','security']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'How to check if your information was breached, and what to do');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'How name variations affect monitoring', 'A difference in how your name is written will not affect Dark Web, compromised-account, or data broker monitoring. However, it does affect Surface Web monitoring, because that process specifically checks for the name exactly as entered in your profile.

To have a specific name variation monitored on the Surface Web (for example "Daniel J du Plessis"), update your account details under Settings → "Your Surveilled Information". You can enter "Daniel J" in the First Name field and "du Plessis" in the Surname field, or enter "J du" in the Middle Name field.', 'How it works', ARRAY['monitoring','name','surface web','profile']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'How name variations affect monitoring');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'How to access the founder offer', 'If the founder offer is active on your account, continue through the onboarding process and proceed with a free scan. The offer becomes available once the onboarding flow is completed, so there is no need to delete your data to access it.

If you experience any issues during the process, contact support and we''ll be happy to assist.', 'FAQ', ARRAY['faq','founder offer','onboarding','free scan']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'How to access the founder offer');

INSERT INTO "KnowledgeBase" (id, "tenantId", title, content, category, tags, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'serus', 'How to upgrade to Autopilot', 'Autopilot (automated removals) is available on the Premium plan; it is not included in the Free or Pro plans. To activate it, go to Settings > Subscription > Upgrade to Premium.

For more details on how the feature works, see https://www.serus.ai/blog/using-autopilot', 'How it works', ARRAY['autopilot','upgrade','premium','subscription']::text[], true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeBase" WHERE "tenantId" = 'serus' AND title = 'How to upgrade to Autopilot');

COMMIT;
