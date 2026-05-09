import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // 1. تسجيل الدخول
  if (req.url.endsWith('/login') && req.method === 'POST') {
    const { code } = req.body;
    if (code === process.env.MASTER_CODE) { // حط 2009 في Environment Variables
      return res.status(200).json({ ok: true });
    }
    return res.status(401).end();
  }

  // 2. حفظ الإعدادات وتشغيل البوت
  if (req.url.endsWith('/deploy') && req.method === 'POST') {
    await kv.set('config', {...req.body, active: true });
    return res.status(200).json({ ok: true });
  }

  // 3. قراءة الإعدادات الحالية
  if (req.url.endsWith('/config') && req.method === 'GET') {
    const config = await kv.get('config') || {};
    delete config.wa_token; // منبعتش التوكن للفرونت
    delete config.gemini_key;
    return res.status(200).json(config);
  }

  // 4. Webhook بتاع واتساب
  if (req.url.endsWith('/webhook')) {
    const config = await kv.get('config');
    if (!config?.active) return res.status(404).end();

    // توثيق Meta
    if (req.method === 'GET') {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      if (mode === 'subscribe' && token === config.verify_token) {
        return res.status(200).send(challenge);
      }
      return res.status(403).end();
    }

    // استقبال رسالة
    if (req.method === 'POST') {
      const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (message?.type === 'text') {
        const from = message.from;
        const text = message.text.body;

        // تأخير طبيعي
        await new Promise(r => setTimeout(r, parseInt(config.delay || 0)));

        // كلم Gemini
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.gemini_key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `اسمك ${config.bot_name}. التعليمات: ${config.bot_prompt}. رد على العميل: ${text}` }]
            }]
          })
        });
        const geminiData = await geminiRes.json();
        const reply = geminiData.candidates[0].content.parts[0].text;

        // ابعت الرد
        await fetch(`https://graph.facebook.com/v20.0/${config.phone_id}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.wa_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: from,
            text: { body: reply }
          })
        });
      }
      return res.status(200).send('EVENT_RECEIVED');
    }
  }
}
