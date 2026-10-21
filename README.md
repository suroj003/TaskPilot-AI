# TaskPilot AI

TaskPilot AI is a productivity assistant that understands normal sentences and organizes your day.
You can write "I have to finish my DSA assignment, practice coding for 2 hours, and attend a meeting at 4 PM"
and it will create the tasks, place the meeting at 16:00, flag overlaps and suggest free time slots.

It is not only a chatbot: the AI calls real backend tools that save to a SQLite database, and the same tools
are also exposed through a self-hosted MCP server.

Built for the **Amazon Developer Hackathon 2026, Alexa+ track**.

## Status: what is implemented and what is not

| Item | Status |
| --- | --- |
| Dashboard, tasks page, daily planner, AI chat, MCP page | Implemented |
| Create, list, edit, complete, reopen, delete tasks | Implemented |
| Priorities (low, medium, high), deadlines, start times, durations | Implemented |
| Search and filters by status, priority, date | Implemented |
| Conflict detection and schedule suggestions (with "apply") | Implemented |
| Stats and progress indicators | Implemented |
| SQLite storage (tasks survive restarts) | Implemented |
| Gemini chat with tool calling (server-side only) | Implemented |
| Self-hosted MCP server, Streamable HTTP at `POST /mcp` | Implemented |
| Alexa+ experience | **Simulated** in the web app (see the "Alexa+ and MCP" page) |
| Real Alexa+ device or service connection | **Not implemented. This app is not connected to Alexa+.** |
| AWS service integration (AWS Builder mini challenge) | **Not implemented yet.** Planned, see below |

Please read the official hackathon rules yourself and check that this project meets them. This README does not
describe or guess any rules.

### Testing status

The code was written without being run by its author. Before submitting, walk through the checklist in
"Verify it works" below and fix anything that fails.

## Tech stack

- Frontend: HTML5, CSS3, vanilla JavaScript (ES modules), responsive layout
- Backend: Node.js 20+, Express
- AI: Gemini API through the official `@google/genai` SDK (called only from the server)
- MCP: official `@modelcontextprotocol/sdk`, Streamable HTTP transport (stateless, JSON responses)
- Database: SQLite through `better-sqlite3`, parameterized queries only
- Dates and times: `luxon`, all "today" logic uses `APP_TIMEZONE`

## Project structure

```
taskpilot-ai/
  package.json
  .env.example
  .gitignore
  README.md
  src/
    server.js            entry point (npm start)
    app.js               Express app
    config/env.js        reads and checks .env
    db/schema.sql        tables
    db/database.js       opens SQLite, runs schema
    middleware/errorHandler.js
    services/taskService.js     task logic and validation
    services/plannerService.js  timeline, conflicts, suggestions
    services/gemini.js          Gemini chat with tool calling
    routes/tasks.js  routes/planner.js  routes/chat.js
    mcp/tools.js         the tool list (used by Gemini and MCP)
    mcp/server.js        MCP server over Streamable HTTP
  public/
    index.html
    css/style.css
    js/api.js  ui.js  dashboard.js  tasks.js  planner.js  chat.js  app.js
```

`ui.js` and `tasks.js` are two small additions to the originally planned structure (shared helpers and the
Tasks page) so the frontend files don't import each other in circles.

## Setup

1. Install Node.js 20 or newer (`node -v` to check).
2. Install packages:
```bash
   npm install
```
   `better-sqlite3` is a native module. If install fails, you may need build tools (Python and a C++ compiler).
3. Create your settings file:
```bash
   cp .env.example .env
```
4. Open `.env` and set at least `GEMINI_API_KEY` (get one at https://aistudio.google.com/apikey).
   - `GEMINI_MODEL` must be a model your key can use. If chat says the model was not found, change this value.
   - `APP_TIMEZONE` should be your IANA timezone (default `Asia/Kolkata`).
5. Never commit `.env`. `.gitignore` already excludes it, and the `data/` folder with the database.

## Run locally

```bash
npm start
```

Then open http://localhost:3000.

For auto-restart while developing: `npm run dev`.

The app works without a Gemini key: the dashboard, tasks, planner and MCP server all run. Only the AI chat and
the Alexa+ simulator need Gemini.

## Verify it works

Go through this list once:

1. `npm start` prints the URLs and no errors. A `data/taskpilot.db` file appears.
2. Open the app, click "Open dashboard", then "Load sample tasks". Cards fill with numbers.
3. Open "Daily planner": the Team meeting and Gym session are marked as a conflict, and a suggestion is shown.
   Click "Apply suggestions" and the conflict disappears.
4. Create, edit, complete and delete a task on the Tasks page. Use the search and filters.
5. Stop the server (Ctrl+C), start it again: the tasks are still there.
6. Open "AI assistant" and send the example sentence. Tasks should appear and "Created ..." chips should show.
7. Remove the Gemini key, restart: chat shows a clear message, everything else still works.
8. Open "Alexa+ and MCP", pick `list_tasks`, press "Run tool": you get a JSON-RPC response with your tasks.

## API reference

All answers are `{ "success": true, "data": ... }` or `{ "success": false, "error": { "message": "..." } }`.
Dates are `YYYY-MM-DD`, times are 24-hour `HH:mm`.

| Method | URL | What it does |
| --- | --- | --- |
| GET | `/api/health` | status, today's date, Gemini configured? |
| GET | `/api/tasks?status=&priority=&date=&search=` | list and filter tasks |
| GET | `/api/tasks/stats` | numbers for the dashboard |
| POST | `/api/tasks/sample` | add demo tasks |
| GET | `/api/tasks/:id` | one task |
| POST | `/api/tasks` | create a task |
| PATCH | `/api/tasks/:id` | change fields (also used to reschedule) |
| POST | `/api/tasks/:id/complete` | mark done, body `{"completed": false}` reopens |
| DELETE | `/api/tasks/:id` | delete a task |
| GET | `/api/planner?date=` | timeline, conflicts, suggestions, summary |
| GET | `/api/planner/conflicts?date=` | only the conflicts |
| GET | `/api/planner/suggestions?date=` | suggested slots (changes nothing) |
| POST | `/api/planner/apply` | save suggested slots, body `{"date": "..."}` |
| POST | `/api/chat` | send a message to the assistant |
| GET / DELETE | `/api/chat/history` | read or clear chat history |
| GET | `/api/chat/status` | is Gemini configured? |
| POST | `/mcp` | MCP endpoint (Streamable HTTP) |

## MCP server

- Endpoint: `http://localhost:3000/mcp` (POST only)
- Transport: Streamable HTTP, stateless mode, plain JSON responses
- Optional protection: set `MCP_AUTH_TOKEN` in `.env`, then clients must send `Authorization: Bearer <token>`
- The server rejects browser requests whose `Origin` does not match the host

Tools (all call the same validated backend functions as the web app):

| Tool | Purpose |
| --- | --- |
| `create_task` | create a task (priority, deadline, day, time, duration) |
| `list_tasks` | list and filter tasks |
| `update_task` | edit or reschedule a task |
| `complete_task` | mark a task completed |
| `delete_task` | delete a task |
| `get_daily_plan` | timeline, conflicts, suggestions for a day |
| `find_conflicts` | overlapping tasks on a day |
| `suggest_schedule` | suggested slots (changes nothing) |
| `apply_schedule_suggestions` | save the suggested slots |
| `get_task_stats` | totals, overdue, completion rate |

### Try it with the MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

In the Inspector choose the "Streamable HTTP" transport and the URL `http://localhost:3000/mcp`, connect,
then list and call the tools.

### Try it with curl

```bash
curl -s http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_task_stats","arguments":{}}}'
```

## About the Alexa+ simulation

The "Alexa+ and MCP" page has a simulator box. You type a sentence as if you said it out loud, it goes to the
same assistant as the chat page, and the answer is shown as a card labelled "Simulated Alexa+ style reply".
No Alexa device, Alexa skill or Alexa+ service is involved. The real, working part is the MCP server above.

## Deployment

The app is a single Node process that serves the website, the API and the MCP endpoint.

1. Pick a host that runs Node 20+ (a VM such as EC2, Render, Railway, Fly.io...).
2. Set the environment variables from `.env.example` in the host's settings (do not upload `.env`).
3. Build step: `npm install`. Start command: `npm start`.
4. SQLite is a file. Put `DATABASE_PATH` on a persistent disk or volume, otherwise data is lost on redeploy.
5. Put HTTPS in front of it (most hosts do this for you). Set `MCP_AUTH_TOKEN` for any public deployment.
6. The "Endpoint" text on the MCP page is built from the request. Behind some proxies it may show `http://`
   instead of `https://`. That is only a display detail.

There is no login system. Anyone who can open the website can see and edit the tasks, so do not put real
private data into a public demo.

## Planned: AWS integration

Not implemented yet, so nothing in the code claims it. A realistic first step is to host the app on an AWS
service and/or back up tasks to an AWS service, behind an environment flag so the core app still works
without it. Check the hackathon rules for which services are eligible before choosing.

## Demo script (about 3 minutes)

1. Landing page: say what it does, and that Alexa+ is simulated while the MCP server is real.
2. Dashboard: click "Load sample tasks" and show the cards.
3. Planner: show the highlighted conflict, then click "Apply suggestions".
4. Assistant: send "I have to finish my DSA assignment, practice coding for 2 hours, and attend a meeting at 4 PM."
   Show the created tasks, then ask "Mark my meeting as done."
5. Alexa+ and MCP page: run `get_task_stats` in the tool tester to show a real MCP call, then use the simulator.

## Security notes

- The Gemini key is read from `.env` and used only on the server. The browser never receives it.
- All SQL uses parameters. Column names in dynamic queries come from fixed lists, never from user input.
- Input is validated with zod in one place and reused by the REST API, Gemini tools and MCP tools.
- User text is escaped before it is put into the page.
- `.env` and the database files are excluded from Git.

## Known limitations

- Tasks cannot repeat, and a task cannot run past midnight in the planner.
- Conflict suggestions only look inside `WORKDAY_START` to `WORKDAY_END`.
- Single user, no accounts.
- The AI can misunderstand a sentence. Check the "Created ..." chips and fix tasks on the Tasks page.