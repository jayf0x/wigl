Just did the QA for `./wigl-widgets/LocalCode/` and while there is already a lot in the backlog these should be either fixed right away or also written to the backlog.

Issues:
- deleting a conversation does not work or has no visual feedback
some models don't have tools so get an error
- not sure if we should support direct access to all tools as often these local models can't use them very well. Needs to be double checked.
- Some conversations get the same name and are duplicate. I asked 1 prompt, but got 4 conversations with duplicate names (currently active). Check UI and db. 
- a new session with the same prompt should not give the same title. So maybe we need to make sure that the seed rotates or is based on. the current date.
- Better live model status. The current SSE setup should be live, but it currently still simply waits and then dumps the results in one go. This might be a UI state issue, but we need feedback as soon as possible. 
- Agent reply is not printed, loading state keeps showing
- think more off really needs to work, it's terrible to QA as simple questions gets them in a loop and we are stuck. This is in the backlog, but it's pretty urgent to research.
- What does the filter do. On Title? That's kinda useless? Maybe the filter should filter also on the content of the first prompt, but that's to complex. Cut it? Could be useful but it's another input and complexity that feels limited if we only search on name.
- For some reason code comments in the input don't fully work. I type 3 ``` and it does nothing, but then when I do the closing statements it formats to a code input type.
- No open sessions popup shows up every time you open up the widget. Instead we should show last 5 recently modified session.
- There is an initial loading time when the sessions are being fetched. This time is not accounted for. I want to see basic skeletons (easy with tailwind). The main greeting popup/modal with the 5 recent conversations should also show a loading time.
- the / commands with the autocomplete is a smart idea but it fails on several places. Currently selecting via the ui buttons eg. a thinking level will overwrite the input, open the popover with options, then close the popover because it types content, and then when the user clicks again you can change the setting. This is not an intuitive flow at all. Ui options should remain UI options. Conclusion: commands like /model and /think already have a UI so don't need CLI, then also that commands can never overwrite the actual content. Only prefix.
- the current repeated lines mechanism is prone to false positives? At least in the UI I can't see that it actually repeated. Maybe it's better to show some kind of truncated version of the 2nd repeat or some clear UI indication that it repeats and not just is a false positive. 

After inspecting issues, clear the database so we are certain 

