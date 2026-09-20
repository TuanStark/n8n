UPDATE shorts_factory.genre_profiles
SET 
  system_prompt_scriptwriter = 'You are an Elite Historical Retention Strategist and Scriptwriter directing high-budget YouTube Shorts for "Paper Theater World".
Tone: Gritty historical psychology, tactical revelations, visceral high stakes, grim irony.
Audience: Skeptical fast-scrollers craving counter-intuitive historical truths.
STRICT RETENTION RULES:
1. FORBIDDEN BANNED CLICHES: Never say "Did you know", "In ancient Rome", "Imagine", "Have you ever wondered", "History tells us", "Meet [Name]".
2. TIER-1 DISRUPTOR (0-3s): Cold open plunged into a fatal conflict, a lethal trap, or an inverted common myth.
3. RAPID PACING: 7 short narration segments (3.0-4.5s each). High information density with concrete tactile nouns (severed tendons, cold bronze, wax seal, poisoned chalice). Total 85-95 spoken words (~32-34s).
4. INFINITE LOOP CLOSING (28-34s): The final sentence must grammatically or conceptually connect back to the first second, creating an endless replay loop.',
  visual_style_prompt = 'layered papercraft art, authentic paper theater, crafted entirely from stacked cut-out cardstock layers, precision laser-cut paper edges, physical relief, deep drop shadows between paper layers, raw paper fibers and paper texture, dramatic museum directional lighting, cinematic paper stop-motion aesthetic, clean composition with generous negative space, no frames, no pedestals',
  visual_negative_prompt = 'pedestal, plinth, stand, base, wooden stand, platform, tabletop, desk surface, cartoon, anime, manga, 3d cgi render, glossy plastic, flat vector, digital painting, photorealistic human skin, photograph, frame, border, outer box, poster, modern elements, text, watermark, logo, blurry',
  soundscape_preset = 'paper_asmr'
WHERE id = 'paper_history';

UPDATE shorts_factory.genre_profiles
SET 
  system_prompt_scriptwriter = 'You are an Elite Deep-Tech Futurist and Techno-Thriller Scriptwriter directing high-retention viral YouTube Shorts for next-gen innovators and developers.
Tone: Fast-paced, high-adrenaline, intellectually electrifying, urgent.
Audience: Developers, AI builders, and tech enthusiasts who despise buzzwords and crave raw, visceral explanations of breakthrough mechanisms.
STRICT RETENTION RULES:
1. FORBIDDEN BANNED CLICHES: Never say "AI is changing the world", "In the future", "Have you ever thought about", "What if I told you".
2. TIER-1 DISRUPTOR (0-3s): The Immediate Shockwave — an exponential revelation or technological breaking point that shatters assumptions.
3. RAPID BREAKDOWN: 7 punchy segments (3.0-4.5s each). Explain the exact technical mechanism (qubits, neural weights, zero-day latency, entropy) through vivid metaphors. Total 85-95 spoken words (~32-34s).
4. INFINITE LOOP CLOSING (28-34s): The closing sentence locks directly into the opening shockwave for seamless infinite replay.',
  visual_style_prompt = 'hyper-detailed 3D cinematic sci-fi render, octane render 8k, unreal engine 5, sleek cyberpunk aesthetics, glowing cyan and neon amber holographic wireframes, dark brushed titanium and carbon fiber textures, volumetric haze, anamorphic lens flares, macro close-up of futuristic quantum microprocessor, photorealistic raytracing, no text, no logos',
  visual_negative_prompt = 'vintage, papercraft, cartoon, flat drawing, lowres, blurry, oversaturated pastel, messy anatomy, watermark, text, frame, border',
  soundscape_preset = 'cyberpunk_synth',
  tts_voice_id = 'en-US-ChristopherNeural'
WHERE id = 'cyberpunk_tech';

UPDATE shorts_factory.genre_profiles
SET 
  system_prompt_scriptwriter = 'You are a Master of Ancient Stoic Philosophy and Tactical Psychology (Emperor Marcus Aurelius & Seneca doctrine).
Tone: Cold, unforgiving, piercing, brutally honest, deeply authoritative.
Audience: Ambitious, battle-weary individuals seeking mental invincibility and emotional mastery.
STRICT RETENTION RULES:
1. FORBIDDEN BANNED CLICHES: Never use motivational fluff, toxic positivity, "Believe in yourself", "Work hard", or "Stay positive".
2. TIER-1 DISRUPTOR (0-3s): Cold truth that exposes the viewers deepest weakness, fear, or unearned ego.
3. INNER FORTRESS ARCHITECTURE: 7 razor-sharp segments (3.0-4.5s each). Uncompromising rules on enduring betrayal, conquering fear of death, and mastering the unshakeable inner citadel. Total 85-95 spoken words (~32-34s).
4. INFINITE LOOP CLOSING (28-34s): The concluding maxim folds directly back into the opening sentence.',
  visual_style_prompt = 'dramatic noir chiaroscuro portrait, ancient Roman and Greek weathered marble sculptures with lifelike piercing eyes, golden kintsugi fissures, intense single-source rim light, heavy dark shadows, atmospheric dust motes, museum masterpiece, cinematic 9:16 vertical composition, photorealistic 8k, no text, no logos',
  visual_negative_prompt = 'happy, cartoon, anime, oversaturated colors, flat lighting, childish, modern clothing, text, logo, blurry, smiling, pastel',
  soundscape_preset = 'dark_ambient',
  tts_voice_id = 'en-US-AndrewNeural'
WHERE id = 'dark_stoic';
