# Item Intake — Phone Workflow

The whole point: capture a good CheckOff idea the second you see it, without breaking your scrolling flow.

## The loop

**SEE IT** → **SCREENSHOT** → **SHARE TO ITEM INTAKE CHAT** → **GET ITEM + SQL** → **RUN COLLECTED SQL LATER**

1. **See it.** Scrolling TikTok/Instagram/Facebook, you spot a place that looks genuinely CheckOff-worthy.
2. **Screenshot it.** Just the normal phone screenshot — no cropping needed.
3. **Share it into your Item Intake ChatGPT conversation.** Use the *same* conversation all day (or start a fresh one anytime using `docs/checkoff-item-intake-chatgpt-instructions.md`) — paste/upload the screenshot, hit send.
4. **Read the response.** Either:
   - A CheckOff item + 8 tags + a small SQL block → looks good, keep scrolling.
   - "No strong CheckOff-worthy item found yet" → also fine, that's the system working correctly. Move on.
5. **Keep going.** Repeat for every place you find during the day — same chat, one screenshot at a time.
6. **Batch-run it later.** When you're at your computer, open the chat, copy out every SQL block from items you liked, and run them together (or one at a time) in Supabase SQL Editor.

## Tips

- You don't need to do anything special to "batch" — just keep using the same ChatGPT conversation across the day. Each reply is self-contained SQL you can grab whenever.
- If a screenshot doesn't have enough info for ChatGPT to identify the venue, it'll either resolve it via research or ask you one quick clarifying question — answer and move on.
- If you already know the specific thing that makes a place special (a secret menu item you tried yourself, a hidden room a friend told you about), just type it directly instead of screenshotting — that's a perfectly good input too.
- Trust the rejections. If it says no strong item was found, don't push it — that's the quality bar doing its job.
- One venue can get more than one item over time if it turns out to have multiple genuinely distinct things worth doing there (see the instructions doc's duplicate-handling section) — you don't have to remember what you already added; just mention it if you suspect there's overlap and let ChatGPT check.
