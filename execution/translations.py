"""
Backend translations for MoneyBook.
All user-facing messages in 10 supported languages.
Usage: t('key', 'hindi', name='Raju', count=5)
"""

_T = {
    # ── Onboarding ──────────────────────────────────────────────
    'welcome': {
        'english':  "🏪 *Welcome to MoneyBook!*\n\nYour digital ledger is getting ready.\n\nWhat is your store's name?",
        'hindi':    "🏪 *MoneyBook mein aapka swagat hai!*\n\nAapka digital khata tayar ho raha hai.\n\nApne store ka naam kya hai?",
        'hinglish': "🏪 *MoneyBook mein aapka swagat hai!*\n\nAapka digital khata tayar ho raha hai.\n\nApne store ka naam kya hai?",
        'gujarati': "🏪 *MoneyBook માં આપનું સ્વાગત છે!*\n\nઆપનું ડિજિટલ ખાતું તૈયાર થઈ રહ્યું છે.\n\nઆપની દુકાનનું નામ શું છે?",
        'marathi':  "🏪 *MoneyBook मध्ये आपले स्वागत!*\n\nआपले डिजिटल खाते तयार होत आहे.\n\nआपल्या दुकानाचे नाव काय आहे?",
        'bengali':  "🏪 *MoneyBook-এ স্বাগতম!*\n\nআপনার ডিজিটাল খাতা তৈরি হচ্ছে।\n\nআপনার দোকানের নাম কী?",
        'tamil':    "🏪 *MoneyBook-க்கு வரவேற்கிறோம்!*\n\nஉங்கள் டிஜிட்டல் கணக்கு தயாராகிறது.\n\nஉங்கள் கடையின் பெயர் என்ன?",
        'telugu':   "🏪 *MoneyBook కి స్వాగతం!*\n\nమీ డిజిటల్ ఖాతా సిద్ధమవుతోంది.\n\nమీ దుకాణం పేరు ఏమిటి?",
        'kannada':  "🏪 *MoneyBook ಗೆ ಸ್ವಾಗತ!*\n\nನಿಮ್ಮ ಡಿಜಿಟಲ್ ಖಾತೆ ತಯಾರಾಗುತ್ತಿದೆ.\n\nನಿಮ್ಮ ಅಂಗಡಿಯ ಹೆಸರು ಏನು?",
        'punjabi':  "🏪 *MoneyBook ਵਿੱਚ ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ!*\n\nਤੁਹਾਡਾ ਡਿਜੀਟਲ ਖਾਤਾ ਤਿਆਰ ਹੋ ਰਿਹਾ ਹੈ।\n\nਤੁਹਾਡੀ ਦੁਕਾਨ ਦਾ ਨਾਮ ਕੀ ਹੈ?",
    },
    'store_name_set': {
        'english':  "✅ *{name}* — great name!\n\n",
        'hindi':    "✅ *{name}* — sundar naam!\n\n",
        'hinglish': "✅ *{name}* — sundar naam!\n\n",
        'gujarati': "✅ *{name}* — સરસ નામ!\n\n",
        'marathi':  "✅ *{name}* — छान नाव!\n\n",
        'bengali':  "✅ *{name}* — চমৎকার নাম!\n\n",
        'tamil':    "✅ *{name}* — அருமையான பெயர்!\n\n",
        'telugu':   "✅ *{name}* — మంచి పేరు!\n\n",
        'kannada':  "✅ *{name}* — ಅದ್ಭುತ ಹೆಸರು!\n\n",
        'punjabi':  "✅ *{name}* — ਵਧੀਆ ਨਾਮ!\n\n",
    },
    'segment_ask': {
        'english':  "What is your business type?\n\n1️⃣ Textile / Clothing\n2️⃣ Grocery / Kirana\n3️⃣ Pharmacy / Medicine\n4️⃣ Hardware / Tools\n5️⃣ Food / Restaurant\n6️⃣ Electronics\n7️⃣ Something else\n\n_(Send a number — 1 to 7)_",
        'hindi':    "Aapka business kya hai?\n\n1️⃣ Kapda / Textile\n2️⃣ Grocery / Kiryana\n3️⃣ Dawai / Pharmacy\n4️⃣ Hardware / Tools\n5️⃣ Khana / Food\n6️⃣ Electronics\n7️⃣ Kuch aur / Other\n\n_(Number bhejein — 1 se 7)_",
        'hinglish': "Aapka business kya hai?\n\n1️⃣ Kapda / Textile\n2️⃣ Grocery / Kiryana\n3️⃣ Dawai / Pharmacy\n4️⃣ Hardware / Tools\n5️⃣ Khana / Food\n6️⃣ Electronics\n7️⃣ Kuch aur / Other\n\n_(Number bhejein — 1 se 7)_",
        'gujarati': "તમારો ધંધો શું છે?\n\n1️⃣ કાપડ / Textile\n2️⃣ કરિયાણા / Grocery\n3️⃣ દવા / Pharmacy\n4️⃣ Hardware / Tools\n5️⃣ ખાણું / Food\n6️⃣ Electronics\n7️⃣ બીજું કંઈ\n\n_(નંબર મોકલો — 1 થી 7)_",
        'marathi':  "तुमचा व्यवसाय काय आहे?\n\n1️⃣ कापड / Textile\n2️⃣ किराणा / Grocery\n3️⃣ औषध / Pharmacy\n4️⃣ Hardware / Tools\n5️⃣ खाणे / Food\n6️⃣ Electronics\n7️⃣ इतर\n\n_(नंबर पाठवा — 1 ते 7)_",
        'bengali':  "আপনার ব্যবসা কী?\n\n1️⃣ কাপড় / Textile\n2️⃣ মুদি / Grocery\n3️⃣ ওষুধ / Pharmacy\n4️⃣ Hardware / Tools\n5️⃣ খাবার / Food\n6️⃣ Electronics\n7️⃣ অন্যকিছু\n\n_(নম্বর পাঠান — 1 থেকে 7)_",
        'tamil':    "உங்கள் தொழில் என்ன?\n\n1️⃣ துணி / Textile\n2️⃣ மளிகை / Grocery\n3️⃣ மருந்து / Pharmacy\n4️⃣ Hardware / Tools\n5️⃣ உணவு / Food\n6️⃣ Electronics\n7️⃣ வேறு\n\n_(எண் அனுப்புங்கள் — 1 முதல் 7)_",
        'telugu':   "మీ వ్యాపారం ఏమిటి?\n\n1️⃣ బట్టలు / Textile\n2️⃣ కిరాణా / Grocery\n3️⃣ మందులు / Pharmacy\n4️⃣ Hardware / Tools\n5️⃣ ఆహారం / Food\n6️⃣ Electronics\n7️⃣ ఇతరం\n\n_(నంబర్ పంపండి — 1 నుండి 7)_",
        'kannada':  "ನಿಮ್ಮ ವ್ಯಾಪಾರ ಏನು?\n\n1️⃣ ಬಟ್ಟೆ / Textile\n2️⃣ ಕಿರಾಣಿ / Grocery\n3️⃣ ಔಷಧ / Pharmacy\n4️⃣ Hardware / Tools\n5️⃣ ಆಹಾರ / Food\n6️⃣ Electronics\n7️⃣ ಬೇರೆ\n\n_(ಸಂಖ್ಯೆ ಕಳುಹಿಸಿ — 1 ರಿಂದ 7)_",
        'punjabi':  "ਤੁਹਾਡਾ ਕਾਰੋਬਾਰ ਕੀ ਹੈ?\n\n1️⃣ ਕੱਪੜਾ / Textile\n2️⃣ ਕਰਿਆਨਾ / Grocery\n3️⃣ ਦਵਾਈ / Pharmacy\n4️⃣ Hardware / Tools\n5️⃣ ਖਾਣਾ / Food\n6️⃣ Electronics\n7️⃣ ਕੁਝ ਹੋਰ\n\n_(ਨੰਬਰ ਭੇਜੋ — 1 ਤੋਂ 7)_",
    },
    'segment_set': {
        'english':  "✅ Segment set: *{label}*\n\nI'll now understand entries based on your business.\n\n",
        'hindi':    "✅ Segment set: *{label}*\n\nAb se main aapke business ke hisaab se entries samjhunga.\n\n",
        'hinglish': "✅ Segment set: *{label}*\n\nAb se main aapke business ke hisaab se entries samjhunga.\n\n",
        'gujarati': "✅ સેગમેન્ટ સેટ: *{label}*\n\nહવે હું તમારા ધંધા પ્રમાણે એન્ટ્રી સમજીશ.\n\n",
        'marathi':  "✅ सेगमेंट सेट: *{label}*\n\nआता मी तुमच्या व्यवसायानुसार एंट्री समजेन.\n\n",
        'bengali':  "✅ সেগমেন্ট সেট: *{label}*\n\nএখন আমি আপনার ব্যবসা অনুযায়ী এন্ট্রি বুঝব।\n\n",
        'tamil':    "✅ பிரிவு அமைக்கப்பட்டது: *{label}*\n\nஇனி உங்கள் தொழில் அடிப்படையில் புரிந்துகொள்வேன்.\n\n",
        'telugu':   "✅ సెగ్మెంట్ సెట్: *{label}*\n\nఇప్పుడు మీ వ్యాపారం ప్రకారం ఎంట్రీలు అర్థం చేసుకుంటాను.\n\n",
        'kannada':  "✅ ಸೆಗ್ಮೆಂಟ್ ಸೆಟ್: *{label}*\n\nಈಗ ನಿಮ್ಮ ವ್ಯಾಪಾರಕ್ಕೆ ಅನುಗುಣವಾಗಿ ಎಂಟ್ರಿಗಳನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳುತ್ತೇನೆ.\n\n",
        'punjabi':  "✅ ਸੈਗਮੈਂਟ ਸੈੱਟ: *{label}*\n\nਹੁਣ ਮੈਂ ਤੁਹਾਡੇ ਕਾਰੋਬਾਰ ਅਨੁਸਾਰ ਐਂਟਰੀਆਂ ਸਮਝਾਂਗਾ।\n\n",
    },

    # ── Help ────────────────────────────────────────────────────
    'help_msg': {
        'english':  "🏪 *MoneyBook — Your Digital Ledger*\n\n*Log a transaction (write naturally):*\n• Sale 5000 cash\n• Raju took 500 on credit\n• CD A. Tiwari 695 _(Cash Discount)_\n• Electricity bill 800 paid\n• Deposited 20000 in bank\n• 📷 Send a photo of your notebook page\n\n*Commands:*\n• /summary → Today's summary\n• /month → This month's summary\n• /quarter → This quarter's summary\n• /year → This year's summary\n• /udhaar → Outstanding dues list\n• /help → This message",
        'hindi':    "🏪 *MoneyBook — Aapka Digital Khata*\n\n*Transaction log karo (naturally likhein):*\n• Sale 5000 cash\n• Raju ne 500 udhaar liya\n• CD A. Tiwari 695  _(Cash Discount)_\n• Bijli bill 800 diya\n• Bank mein 20000 jama kiya\n• 📷 Notebook page ki photo bhejein\n\n*Commands:*\n• /summary  → Aaj ka hisaab\n• /month    → Is mahine ka summary\n• /quarter  → Is quarter ka summary\n• /year     → Is saal ka summary\n• /udhaar   → Outstanding udhaar list\n• /help     → Yeh message",
        'hinglish': "🏪 *MoneyBook — Aapka Digital Khata*\n\n*Transaction log karo (naturally likhein):*\n• Sale 5000 cash\n• Raju ne 500 udhaar liya\n• CD A. Tiwari 695  _(Cash Discount)_\n• Bijli bill 800 diya\n• Bank mein 20000 jama kiya\n• 📷 Notebook page ki photo bhejein\n\n*Commands:*\n• /summary  → Aaj ka hisaab\n• /month    → Is mahine ka summary\n• /quarter  → Is quarter ka summary\n• /year     → Is saal ka summary\n• /udhaar   → Outstanding udhaar list\n• /help     → Yeh message",
        'gujarati': "🏪 *MoneyBook — તમારું ડિજિટલ ખાતું*\n\n*ટ્રાન્ઝેક્શન લખો (કુદરતી રીતે):*\n• વેચાણ 5000 રોકડ\n• રાજુએ 500 ઉધાર લીધા\n• CD A. Tiwari 695 _(કેશ ડિસ્કાઉન્ટ)_\n• વીજળી બિલ 800 ચૂકવ્યું\n• બેંકમાં 20000 જમા કર્યા\n• 📷 નોટબુક પેજનો ફોટો મોકલો\n\n*Commands:*\n• /summary → આજનો હિસાબ\n• /month → આ મહિનાનો સારાંશ\n• /quarter → આ ક્વાર્ટરનો સારાંશ\n• /year → આ વર્ષનો સારાંશ\n• /udhaar → બાકી ઉધાર યાદી\n• /help → આ સંદેશ",
        'marathi':  "🏪 *MoneyBook — तुमचे डिजिटल खाते*\n\n*व्यवहार नोंदवा (नैसर्गिकपणे लिहा):*\n• विक्री 5000 रोख\n• राजूने 500 उधार घेतले\n• CD A. Tiwari 695 _(कॅश डिस्काउंट)_\n• वीज बिल 800 भरले\n• बँकेत 20000 जमा केले\n• 📷 वहीच्या पानाचा फोटो पाठवा\n\n*Commands:*\n• /summary → आजचा हिशोब\n• /month → या महिन्याचा सारांश\n• /quarter → या तिमाहीचा सारांश\n• /year → या वर्षाचा सारांश\n• /udhaar → थकीत उधारी यादी\n• /help → हा संदेश",
        'bengali':  "🏪 *MoneyBook — আপনার ডিজিটাল খাতা*\n\n*লেনদেন লিখুন (স্বাভাবিকভাবে):*\n• বিক্রি 5000 নগদ\n• রাজু 500 বাকি নিল\n• CD A. Tiwari 695 _(ক্যাশ ডিসকাউন্ট)_\n• বিদ্যুৎ বিল 800 দিলাম\n• ব্যাংকে 20000 জমা দিলাম\n• 📷 নোটবুক পাতার ছবি পাঠান\n\n*Commands:*\n• /summary → আজকের হিসাব\n• /month → এই মাসের সারাংশ\n• /quarter → এই ত্রৈমাসিকের সারাংশ\n• /year → এই বছরের সারাংশ\n• /udhaar → বাকি পাওনা তালিকা\n• /help → এই বার্তা",
        'tamil':    "🏪 *MoneyBook — உங்கள் டிஜிட்டல் கணக்கு*\n\n*பரிவர்த்தனை பதிவு (இயற்கையாக எழுதுங்கள்):*\n• விற்பனை 5000 ரொக்கம்\n• ராஜு 500 கடன் வாங்கினார்\n• CD A. Tiwari 695 _(கேஷ் டிஸ்கவுண்ட்)_\n• மின் கட்டணம் 800 செலுத்தினேன்\n• வங்கியில் 20000 டெபாசிட்\n• 📷 நோட்புக் பக்கத்தின் புகைப்படம் அனுப்புங்கள்\n\n*Commands:*\n• /summary → இன்றைய கணக்கு\n• /month → இந்த மாத சுருக்கம்\n• /quarter → இந்த காலாண்டு சுருக்கம்\n• /year → இந்த ஆண்டு சுருக்கம்\n• /udhaar → நிலுவை கடன் பட்டியல்\n• /help → இந்த செய்தி",
        'telugu':   "🏪 *MoneyBook — మీ డిజిటల్ ఖాతా*\n\n*లావాదేవీ నమోదు (సహజంగా రాయండి):*\n• అమ్మకం 5000 నగదు\n• రాజు 500 అప్పు తీసుకున్నాడు\n• CD A. Tiwari 695 _(కాష్ డిస్కౌంట్)_\n• విద్యుత్ బిల్లు 800 చెల్లించాను\n• బ్యాంకులో 20000 జమ\n• 📷 నోట్బుక్ పేజీ ఫోటో పంపండి\n\n*Commands:*\n• /summary → ఈరోజు లెక్క\n• /month → ఈ నెల సారాంశం\n• /quarter → ఈ క్వార్టర్ సారాంశం\n• /year → ఈ సంవత్సరం సారాంశం\n• /udhaar → బకాయి జాబితా\n• /help → ఈ సందేశం",
        'kannada':  "🏪 *MoneyBook — ನಿಮ್ಮ ಡಿಜಿಟಲ್ ಖಾತೆ*\n\n*ವ್ಯವಹಾರ ದಾಖಲಿಸಿ (ಸಹಜವಾಗಿ ಬರೆಯಿರಿ):*\n• ಮಾರಾಟ 5000 ನಗದು\n• ರಾಜು 500 ಸಾಲ ತೆಗೆದುಕೊಂಡರು\n• CD A. Tiwari 695 _(ಕ್ಯಾಶ್ ಡಿಸ್ಕೌಂಟ್)_\n• ವಿದ್ಯುತ್ ಬಿಲ್ 800 ಪಾವತಿಸಿದೆ\n• ಬ್ಯಾಂಕಿಗೆ 20000 ಜಮಾ\n• 📷 ನೋಟ್ಬುಕ್ ಪುಟದ ಫೋಟೋ ಕಳುಹಿಸಿ\n\n*Commands:*\n• /summary → ಇಂದಿನ ಲೆಕ್ಕ\n• /month → ಈ ತಿಂಗಳ ಸಾರಾಂಶ\n• /quarter → ಈ ತ್ರೈಮಾಸಿಕ ಸಾರಾಂಶ\n• /year → ಈ ವರ್ಷದ ಸಾರಾಂಶ\n• /udhaar → ಬಾಕಿ ಪಟ್ಟಿ\n• /help → ಈ ಸಂದೇಶ",
        'punjabi':  "🏪 *MoneyBook — ਤੁਹਾਡਾ ਡਿਜੀਟਲ ਖਾਤਾ*\n\n*ਲੈਣ-ਦੇਣ ਲਿਖੋ (ਕੁਦਰਤੀ ਤਰੀਕੇ ਨਾਲ):*\n• ਵਿਕਰੀ 5000 ਨਕਦ\n• ਰਾਜੂ ਨੇ 500 ਉਧਾਰ ਲਿਆ\n• CD A. Tiwari 695 _(ਕੈਸ਼ ਡਿਸਕਾਊਂਟ)_\n• ਬਿਜਲੀ ਬਿੱਲ 800 ਦਿੱਤਾ\n• ਬੈਂਕ ਵਿੱਚ 20000 ਜਮ੍ਹਾ ਕੀਤੇ\n• 📷 ਨੋਟਬੁੱਕ ਪੰਨੇ ਦੀ ਫੋਟੋ ਭੇਜੋ\n\n*Commands:*\n• /summary → ਅੱਜ ਦਾ ਹਿਸਾਬ\n• /month → ਇਸ ਮਹੀਨੇ ਦਾ ਸਾਰ\n• /quarter → ਇਸ ਤਿਮਾਹੀ ਦਾ ਸਾਰ\n• /year → ਇਸ ਸਾਲ ਦਾ ਸਾਰ\n• /udhaar → ਬਕਾਇਆ ਉਧਾਰ ਸੂਚੀ\n• /help → ਇਹ ਸੁਨੇਹਾ",
    },

    # ── Photo processing ────────────────────────────────────────
    'photo_processing': {
        'english':  "📷 Photo received! Reading it... please wait ⏳",
        'hindi':    "📷 Photo mil gayi! Padh raha hoon... thoda wait karein ⏳",
        'hinglish': "📷 Photo mil gayi! Padh raha hoon... thoda wait karein ⏳",
        'gujarati': "📷 ફોટો મળ્યો! વાંચી રહ્યો છું... થોડી રાહ જુઓ ⏳",
        'marathi':  "📷 फोटो मिळाला! वाचत आहे... थोडे थांबा ⏳",
        'bengali':  "📷 ছবি পেয়েছি! পড়ছি... একটু অপেক্ষা করুন ⏳",
        'tamil':    "📷 புகைப்படம் கிடைத்தது! படிக்கிறேன்... சிறிது காத்திருங்கள் ⏳",
        'telugu':   "📷 ఫోటో వచ్చింది! చదువుతున్నాను... కొంచెం వేచి ఉండండి ⏳",
        'kannada':  "📷 ಫೋಟೋ ಸಿಕ್ಕಿತು! ಓದುತ್ತಿದ್ದೇನೆ... ಸ್ವಲ್ಪ ಕಾಯಿರಿ ⏳",
        'punjabi':  "📷 ਫੋਟੋ ਮਿਲ ਗਈ! ਪੜ੍ਹ ਰਿਹਾ ਹਾਂ... ਥੋੜਾ ਉਡੀਕ ਕਰੋ ⏳",
    },
    'photo_empty': {
        'english':  "Couldn't read the photo 🤔\nPlease add entries manually using the 📋 ledger grid.",
        'hindi':    "Photo padh nahi paaye 🤔\n📋 Ledger grid mein manually entry karein.",
        'hinglish': "Photo padh nahi paaye 🤔\n📋 Ledger grid mein manually entry karein.",
        'gujarati': "ફોટો વાંચી ન શક્યા 🤔\n📋 લેજર ગ્રિડમાં જાતે એન્ટ્રી કરો.",
        'marathi':  "फोटो वाचता आला नाही 🤔\n📋 लेजर ग्रिडमध्ये स्वतः एंट्री करा.",
        'bengali':  "ছবি পড়া যায়নি 🤔\n📋 লেজার গ্রিডে নিজে এন্ট্রি করুন।",
        'tamil':    "புகைப்படம் படிக்க முடியவில்லை 🤔\n📋 லெட்ஜர் கிரிட்டில் நேரடியாக பதிவு செய்யுங்கள்.",
        'telugu':   "ఫోటో చదవలేకపోయాము 🤔\n📋 లెడ్జర్ గ్రిడ్‌లో మాన్యువల్‌గా ఎంట్రీ చేయండి.",
        'kannada':  "ಫೋಟೋ ಓದಲಾಗಲಿಲ್ಲ 🤔\n📋 ಲೆಡ್ಜರ್ ಗ್ರಿಡ್‌ನಲ್ಲಿ ಎಂಟ್ರಿ ಮಾಡಿ.",
        'punjabi':  "ਫੋਟੋ ਪੜ੍ਹ ਨਹੀਂ ਹੋਈ 🤔\n📋 ਲੈਜਰ ਗ੍ਰਿਡ ਵਿੱਚ ਖੁਦ ਐਂਟਰੀ ਕਰੋ।",
    },
    'photo_ocr_fail': {
        'english':  "Couldn't read entries clearly 🤔\nPlease add entries manually using the 📋 ledger grid.\n\n*Text found:*\n_{ocr}_",
        'hindi':    "Entries clearly padh nahi paaye 🤔\n📋 Ledger grid mein manually entry karein.\n\n*Yeh text mila:*\n_{ocr}_",
        'hinglish': "Entries clearly padh nahi paaye 🤔\n📋 Ledger grid mein manually entry karein.\n\n*Yeh text mila:*\n_{ocr}_",
        'gujarati': "એન્ટ્રી સ્પષ્ટ વાંચી ન શક્યા 🤔\n📋 લેજર ગ્રિડમાં જાતે એન્ટ્રી કરો.\n\n*આ ટેક્સ્ટ મળ્યો:*\n_{ocr}_",
        'marathi':  "एंट्री स्पष्ट वाचता आल्या नाहीत 🤔\n📋 लेजर ग्रिडमध्ये स्वतः एंट्री करा.\n\n*हा मजकूर मिळाला:*\n_{ocr}_",
        'bengali':  "এন্ট্রি স্পষ্টভাবে পড়া যায়নি 🤔\n📋 লেজার গ্রিডে নিজে এন্ট্রি করুন।\n\n*এই টেক্সট পাওয়া গেছে:*\n_{ocr}_",
        'tamil':    "பதிவுகளை தெளிவாக படிக்க முடியவில்லை 🤔\n📋 லெட்ஜர் கிரிட்டில் நேரடியாக பதிவு செய்யுங்கள்.\n\n*கிடைத்த உரை:*\n_{ocr}_",
        'telugu':   "ఎంట్రీలు స్పష్టంగా చదవలేకపోయాము 🤔\n📋 లెడ్జర్ గ్రిడ్‌లో మాన్యువల్‌గా ఎంట్రీ చేయండి.\n\n*దొరికిన టెక్స్ట్:*\n_{ocr}_",
        'kannada':  "ಎಂಟ್ರಿಗಳನ್ನು ಸ್ಪಷ್ಟವಾಗಿ ಓದಲಾಗಲಿಲ್ಲ 🤔\n📋 ಲೆಡ್ಜರ್ ಗ್ರಿಡ್‌ನಲ್ಲಿ ಎಂಟ್ರಿ ಮಾಡಿ.\n\n*ಸಿಕ್ಕ ಪಠ್ಯ:*\n_{ocr}_",
        'punjabi':  "ਐਂਟਰੀਆਂ ਸਾਫ਼ ਪੜ੍ਹ ਨਹੀਂ ਹੋਈਆਂ 🤔\n📋 ਲੈਜਰ ਗ੍ਰਿਡ ਵਿੱਚ ਖੁਦ ਐਂਟਰੀ ਕਰੋ।\n\n*ਮਿਲਿਆ ਟੈਕਸਟ:*\n_{ocr}_",
    },

    # ── Confirmation flow ───────────────────────────────────────
    'confirm_saved': {
        'english':  "✅ *{count} entries saved!*\n\nReady for the next entry 📒",
        'hindi':    "✅ *{count} entries save ho gayi!*\n\nAgle entry ke liye ready hoon 📒",
        'hinglish': "✅ *{count} entries save ho gayi!*\n\nAgle entry ke liye ready hoon 📒",
        'gujarati': "✅ *{count} એન્ટ્રી સેવ થઈ!*\n\nઆગળની એન્ટ્રી માટે તૈયાર છું 📒",
        'marathi':  "✅ *{count} एंट्री सेव झाल्या!*\n\nपुढच्या एंट्रीसाठी तयार आहे 📒",
        'bengali':  "✅ *{count}টি এন্ট্রি সেভ হয়েছে!*\n\nপরের এন্ট্রির জন্য প্রস্তুত 📒",
        'tamil':    "✅ *{count} பதிவுகள் சேமிக்கப்பட்டன!*\n\nஅடுத்த பதிவுக்கு தயார் 📒",
        'telugu':   "✅ *{count} ఎంట్రీలు సేవ్ అయ్యాయి!*\n\nతదుపరి ఎంట్రీకి సిద్ధం 📒",
        'kannada':  "✅ *{count} ಎಂಟ್ರಿಗಳು ಉಳಿಸಲಾಗಿದೆ!*\n\nಮುಂದಿನ ಎಂಟ್ರಿಗೆ ಸಿದ್ಧ 📒",
        'punjabi':  "✅ *{count} ਐਂਟਰੀਆਂ ਸੇਵ ਹੋ ਗਈਆਂ!*\n\nਅਗਲੀ ਐਂਟਰੀ ਲਈ ਤਿਆਰ ਹਾਂ 📒",
    },
    'confirm_cancel': {
        'english':  "❌ Cancelled. Send a new entry.",
        'hindi':    "❌ Cancel ho gaya. Naya entry bhejein.",
        'hinglish': "❌ Cancel ho gaya. Naya entry bhejein.",
        'gujarati': "❌ રદ કરાયું. નવી એન્ટ્રી મોકલો.",
        'marathi':  "❌ रद्द केले. नवीन एंट्री पाठवा.",
        'bengali':  "❌ বাতিল হয়েছে। নতুন এন্ট্রি পাঠান।",
        'tamil':    "❌ ரத்து செய்யப்பட்டது. புதிய பதிவு அனுப்புங்கள்.",
        'telugu':   "❌ రద్దు చేయబడింది. కొత్త ఎంట్రీ పంపండి.",
        'kannada':  "❌ ರದ್ದಾಗಿದೆ. ಹೊಸ ಎಂಟ್ರಿ ಕಳುಹಿಸಿ.",
        'punjabi':  "❌ ਰੱਦ ਹੋ ਗਿਆ। ਨਵੀਂ ਐਂਟਰੀ ਭੇਜੋ।",
    },
    'confirm_help': {
        'english':  "Didn't understand 🤔\n\n• *yes* → Save all\n• *wrong 3* → Fix entry 3\n• *3 tag electricity* → Change tag of entry 3\n• *cancel* → Cancel\n\n",
        'hindi':    "Samajh nahi aaya 🤔\n\n• *haan* → Sab save karo\n• *galat 3* → Entry 3 theek karo\n• *3 tag electricity* → Entry 3 ka tag badlo\n• *cancel* → Cancel\n\n",
        'hinglish': "Samajh nahi aaya 🤔\n\n• *haan* → Sab save karo\n• *galat 3* → Entry 3 theek karo\n• *3 tag electricity* → Entry 3 ka tag badlo\n• *cancel* → Cancel\n\n",
        'gujarati': "સમજાયું નહીં 🤔\n\n• *હા* → બધું સેવ કરો\n• *ખોટું 3* → એન્ટ્રી 3 સુધારો\n• *3 tag electricity* → એન્ટ્રી 3 નો ટેગ બદલો\n• *cancel* → રદ કરો\n\n",
        'marathi':  "समजले नाही 🤔\n\n• *हो* → सर्व सेव करा\n• *चूक 3* → एंट्री 3 दुरुस्त करा\n• *3 tag electricity* → एंट्री 3 चा टॅग बदला\n• *cancel* → रद्द करा\n\n",
        'bengali':  "বুঝতে পারলাম না 🤔\n\n• *হ্যাঁ* → সব সেভ করো\n• *ভুল 3* → এন্ট্রি 3 ঠিক করো\n• *3 tag electricity* → এন্ট্রি 3 এর ট্যাগ বদলাও\n• *cancel* → বাতিল\n\n",
        'tamil':    "புரியவில்லை 🤔\n\n• *ஆமா* → எல்லாம் சேமி\n• *தவறு 3* → பதிவு 3 சரிசெய்\n• *3 tag electricity* → பதிவு 3 குறிச்சொல் மாற்று\n• *cancel* → ரத்து\n\n",
        'telugu':   "అర్థం కాలేదు 🤔\n\n• *అవును* → అన్నీ సేవ్ చేయి\n• *తప్పు 3* → ఎంట్రీ 3 సరిచేయి\n• *3 tag electricity* → ఎంట్రీ 3 ట్యాగ్ మార్చు\n• *cancel* → రద్దు\n\n",
        'kannada':  "ಅರ್ಥವಾಗಲಿಲ್ಲ 🤔\n\n• *ಹೌದು* → ಎಲ್ಲಾ ಉಳಿಸಿ\n• *ತಪ್ಪು 3* → ಎಂಟ್ರಿ 3 ಸರಿಪಡಿಸಿ\n• *3 tag electricity* → ಎಂಟ್ರಿ 3 ಟ್ಯಾಗ್ ಬದಲಿಸಿ\n• *cancel* → ರದ್ದು\n\n",
        'punjabi':  "ਸਮਝ ਨਹੀਂ ਆਇਆ 🤔\n\n• *ਹਾਂ* → ਸਭ ਸੇਵ ਕਰੋ\n• *ਗਲਤ 3* → ਐਂਟਰੀ 3 ਠੀਕ ਕਰੋ\n• *3 tag electricity* → ਐਂਟਰੀ 3 ਦਾ ਟੈਗ ਬਦਲੋ\n• *cancel* → ਰੱਦ ਕਰੋ\n\n",
    },
    'correction_prompt': {
        'english':  "✏️ *Fix entry {idx}:*\n_{desc} — ₹{amount} {emoji}_\n\nSend the correct info\n_(e.g. 'amount was 750' or 'this was Raju's credit')_",
        'hindi':    "✏️ *Entry {idx} theek karo:*\n_{desc} — ₹{amount} {emoji}_\n\nSahi info bhejein\n_(e.g. 'amount 750 tha' ya 'yeh Raju ka udhaar tha')_",
        'hinglish': "✏️ *Entry {idx} theek karo:*\n_{desc} — ₹{amount} {emoji}_\n\nSahi info bhejein\n_(e.g. 'amount 750 tha' ya 'yeh Raju ka udhaar tha')_",
        'gujarati': "✏️ *એન્ટ્રી {idx} સુધારો:*\n_{desc} — ₹{amount} {emoji}_\n\nસાચી માહિતી મોકલો\n_(દા.ત. 'રકમ 750 હતી' અથવા 'આ રાજુનું ઉધાર હતું')_",
        'marathi':  "✏️ *एंट्री {idx} दुरुस्त करा:*\n_{desc} — ₹{amount} {emoji}_\n\nबरोबर माहिती पाठवा\n_(उदा. 'रक्कम 750 होती' किंवा 'हे राजूचे उधार होते')_",
        'bengali':  "✏️ *এন্ট্রি {idx} ঠিক করুন:*\n_{desc} — ₹{amount} {emoji}_\n\nসঠিক তথ্য পাঠান\n_(যেমন 'পরিমাণ 750 ছিল' বা 'এটা রাজুর বাকি ছিল')_",
        'tamil':    "✏️ *பதிவு {idx} சரிசெய்:*\n_{desc} — ₹{amount} {emoji}_\n\nசரியான தகவல் அனுப்புங்கள்\n_(எ.கா. 'தொகை 750' அல்லது 'இது ராஜுவின் கடன்')_",
        'telugu':   "✏️ *ఎంట్రీ {idx} సరిచేయండి:*\n_{desc} — ₹{amount} {emoji}_\n\nసరైన సమాచారం పంపండి\n_(ఉదా. 'మొత్తం 750' లేదా 'ఇది రాజు అప్పు')_",
        'kannada':  "✏️ *ಎಂಟ್ರಿ {idx} ಸರಿಪಡಿಸಿ:*\n_{desc} — ₹{amount} {emoji}_\n\nಸರಿಯಾದ ಮಾಹಿತಿ ಕಳುಹಿಸಿ\n_(ಉದಾ. 'ಮೊತ್ತ 750 ಆಗಿತ್ತು' ಅಥವಾ 'ಇದು ರಾಜುವಿನ ಸಾಲ')_",
        'punjabi':  "✏️ *ਐਂਟਰੀ {idx} ਠੀਕ ਕਰੋ:*\n_{desc} — ₹{amount} {emoji}_\n\nਸਹੀ ਜਾਣਕਾਰੀ ਭੇਜੋ\n_(ਜਿਵੇਂ 'ਰਕਮ 750 ਸੀ' ਜਾਂ 'ਇਹ ਰਾਜੂ ਦਾ ਉਧਾਰ ਸੀ')_",
    },
    'entry_not_found': {
        'english':  "Entry {idx} not found. Send a number between 1 and {total}.",
        'hindi':    "Entry {idx} nahi mili. 1 se {total} ke beech number bhejein.",
        'hinglish': "Entry {idx} nahi mili. 1 se {total} ke beech number bhejein.",
        'gujarati': "એન્ટ્રી {idx} મળી નહીં. 1 થી {total} વચ્ચે નંબર મોકલો.",
        'marathi':  "एंट्री {idx} सापडली नाही. 1 ते {total} दरम्यान क्रमांक पाठवा.",
        'bengali':  "এন্ট্রি {idx} পাওয়া যায়নি। 1 থেকে {total} এর মধ্যে নম্বর পাঠান।",
        'tamil':    "பதிவு {idx} கிடைக்கவில்லை. 1 முதல் {total} வரை எண் அனுப்புங்கள்.",
        'telugu':   "ఎంట్రీ {idx} దొరకలేదు. 1 నుండి {total} మధ్య నంబర్ పంపండి.",
        'kannada':  "ಎಂಟ್ರಿ {idx} ಸಿಗಲಿಲ್ಲ. 1 ರಿಂದ {total} ನಡುವೆ ಸಂಖ್ಯೆ ಕಳುಹಿಸಿ.",
        'punjabi':  "ਐਂਟਰੀ {idx} ਨਹੀਂ ਮਿਲੀ। 1 ਤੋਂ {total} ਵਿਚਕਾਰ ਨੰਬਰ ਭੇਜੋ।",
    },
    'person_classify_done': {
        'english':  "All persons registered! 🎉\nReady for the next entry 📒",
        'hindi':    "Sab log register ho gaye! 🎉\nAgle entry ke liye ready hoon 📒",
        'hinglish': "Sab log register ho gaye! 🎉\nAgle entry ke liye ready hoon 📒",
        'gujarati': "બધા લોકો રજિસ્ટર થઈ ગયા! 🎉\nઆગળની એન્ટ્રી માટે તૈયાર છું 📒",
        'marathi':  "सर्व लोक नोंदणीकृत झाले! 🎉\nपुढच्या एंट्रीसाठी तयार आहे 📒",
        'bengali':  "সবাই রেজিস্টার হয়ে গেছে! 🎉\nপরের এন্ট্রির জন্য প্রস্তুত 📒",
        'tamil':    "அனைவரும் பதிவு செய்யப்பட்டனர்! 🎉\nஅடுத்த பதிவுக்கு தயார் 📒",
        'telugu':   "అందరూ రిజిస్టర్ అయ్యారు! 🎉\nతదుపరి ఎంట్రీకి సిద్ధం 📒",
        'kannada':  "ಎಲ್ಲರೂ ನೋಂದಾಯಿತರಾಗಿದ್ದಾರೆ! 🎉\nಮುಂದಿನ ಎಂಟ್ರಿಗೆ ಸಿದ್ಧ 📒",
        'punjabi':  "ਸਾਰੇ ਲੋਕ ਰਜਿਸਟਰ ਹੋ ਗਏ! 🎉\nਅਗਲੀ ਐਂਟਰੀ ਲਈ ਤਿਆਰ ਹਾਂ 📒",
    },

    # ── Errors ──────────────────────────────────────────────────
    'ai_busy': {
        'english':  "⚠️ AI is busy. Please try again in 1 minute.",
        'hindi':    "⚠️ AI busy hai. 1 minute baad dobara try karein.",
        'hinglish': "⚠️ AI busy hai. 1 minute baad dobara try karein.",
        'gujarati': "⚠️ AI વ્યસ્ત છે. 1 મિનિટ પછી ફરી પ્રયાસ કરો.",
        'marathi':  "⚠️ AI व्यस्त आहे. 1 मिनिटानंतर पुन्हा प्रयत्न करा.",
        'bengali':  "⚠️ AI ব্যস্ত। 1 মিনিট পরে আবার চেষ্টা করুন।",
        'tamil':    "⚠️ AI பிஸியாக உள்ளது. 1 நிமிடம் கழித்து மீண்டும் முயற்சிக்கவும்.",
        'telugu':   "⚠️ AI బిజీగా ఉంది. 1 నిమిషం తర్వాత మళ్ళీ ప్రయత్నించండి.",
        'kannada':  "⚠️ AI ಬ್ಯುಸಿ ಆಗಿದೆ. 1 ನಿಮಿಷ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
        'punjabi':  "⚠️ AI ਵਿਅਸਤ ਹੈ। 1 ਮਿੰਟ ਬਾਅਦ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
    },
    'ai_busy_photo': {
        'english':  "⚠️ AI is busy. Please resend the photo in 2 minutes.",
        'hindi':    "⚠️ AI busy hai. 2 minute baad photo dobara bhejein.",
        'hinglish': "⚠️ AI busy hai. 2 minute baad photo dobara bhejein.",
        'gujarati': "⚠️ AI વ્યસ્ત છે. 2 મિનિટ પછી ફોટો ફરી મોકલો.",
        'marathi':  "⚠️ AI व्यस्त आहे. 2 मिनिटांनी फोटो पुन्हा पाठवा.",
        'bengali':  "⚠️ AI ব্যস্ত। 2 মিনিট পরে ছবি আবার পাঠান।",
        'tamil':    "⚠️ AI பிஸியாக உள்ளது. 2 நிமிடம் கழித்து புகைப்படம் மீண்டும் அனுப்புங்கள்.",
        'telugu':   "⚠️ AI బిజీగా ఉంది. 2 నిమిషాల తర్వాత ఫోటో మళ్ళీ పంపండి.",
        'kannada':  "⚠️ AI ಬ್ಯುಸಿ ಆಗಿದೆ. 2 ನಿಮಿಷ ನಂತರ ಫೋಟೋ ಮತ್ತೆ ಕಳುಹಿಸಿ.",
        'punjabi':  "⚠️ AI ਵਿਅਸਤ ਹੈ। 2 ਮਿੰਟ ਬਾਅਦ ਫੋਟੋ ਦੁਬਾਰਾ ਭੇਜੋ।",
    },
    'parse_fail': {
        'english':  "Couldn't understand 🙏\nExample: 'Sale 5000 cash' or 'Raju took 500 on credit'",
        'hindi':    "Samajh nahi aaya 🙏\nExample: 'Sale 5000 cash' ya 'Raju ne 500 udhaar liya'",
        'hinglish': "Samajh nahi aaya 🙏\nExample: 'Sale 5000 cash' ya 'Raju ne 500 udhaar liya'",
        'gujarati': "સમજાયું નહીં 🙏\nઉદાહરણ: 'વેચાણ 5000 રોકડ' અથવા 'રાજુએ 500 ઉધાર લીધા'",
        'marathi':  "समजले नाही 🙏\nउदाहरण: 'विक्री 5000 रोख' किंवा 'राजूने 500 उधार घेतले'",
        'bengali':  "বুঝতে পারলাম না 🙏\nউদাহরণ: 'বিক্রি 5000 নগদ' বা 'রাজু 500 বাকি নিল'",
        'tamil':    "புரியவில்லை 🙏\nஉதாரணம்: 'விற்பனை 5000 ரொக்கம்' அல்லது 'ராஜு 500 கடன் வாங்கினார்'",
        'telugu':   "అర్థం కాలేదు 🙏\nఉదాహరణ: 'అమ్మకం 5000 నగదు' లేదా 'రాజు 500 అప్పు తీసుకున్నాడు'",
        'kannada':  "ಅರ್ಥವಾಗಲಿಲ್ಲ 🙏\nಉದಾಹರಣೆ: 'ಮಾರಾಟ 5000 ನಗದು' ಅಥವಾ 'ರಾಜು 500 ಸಾಲ ತೆಗೆದುಕೊಂಡರು'",
        'punjabi':  "ਸਮਝ ਨਹੀਂ ਆਇਆ 🙏\nਉਦਾਹਰਨ: 'ਵਿਕਰੀ 5000 ਨਕਦ' ਜਾਂ 'ਰਾਜੂ ਨੇ 500 ਉਧਾਰ ਲਿਆ'",
    },
    'classify_cancel': {
        'english':  "❌ Classification cancelled. Send a new entry.",
        'hindi':    "❌ Classification cancel ho gayi. Koi nayi entry bhejein.",
        'hinglish': "❌ Classification cancel ho gayi. Koi nayi entry bhejein.",
        'gujarati': "❌ વર્ગીકરણ રદ. નવી એન્ટ્રી મોકલો.",
        'marathi':  "❌ वर्गीकरण रद्द. नवीन एंट्री पाठवा.",
        'bengali':  "❌ শ্রেণীবিভাগ বাতিল। নতুন এন্ট্রি পাঠান।",
        'tamil':    "❌ வகைப்படுத்தல் ரத்து. புதிய பதிவு அனுப்புங்கள்.",
        'telugu':   "❌ వర్గీకరణ రద్దు. కొత్త ఎంట్రీ పంపండి.",
        'kannada':  "❌ ವರ್ಗೀಕರಣ ರದ್ದಾಗಿದೆ. ಹೊಸ ಎಂಟ್ರಿ ಕಳುಹಿಸಿ.",
        'punjabi':  "❌ ਵਰਗੀਕਰਨ ਰੱਦ। ਨਵੀਂ ਐਂਟਰੀ ਭੇਜੋ।",
    },
}


def t(key: str, lang: str = 'hinglish', **kwargs) -> str:
    """Get translated string. Falls back to hinglish → english → key."""
    entry = _T.get(key)
    if not entry:
        return key
    text = entry.get(lang) or entry.get('hinglish') or entry.get('english') or key
    if kwargs:
        try:
            text = text.format(**kwargs)
        except (KeyError, IndexError):
            pass
    return text
