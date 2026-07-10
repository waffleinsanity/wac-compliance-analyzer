# WAC Compliance Analyzer

Self-contained web application for Washington Administrative Code (WAC) **246-341** and **246-337** investigative report drafting and compliance analysis.

## Features

- Hierarchical PDF ingestion (code → (1) → (a) → (i)) into SQLite + ChromaDB
- Complaint / allegation intake with case metadata
- Multi-select WAC authorization directory (search, favorites)
- PDF-sourced subsection matching and formal allegation drafting
- Investigation Report template: Regulatory Framework, allegations, 5 evidentiary examples, process, conclusions
- Local compliance findings (five output templates) · trigger phrases · stats · optional official-site validation

## Quick start

### 1. Backend

```bat
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Or run `start-backend.bat` from the project root.

On first startup the API parses `data/source/WAC 246-341.pdf` and `data/source/WAC 246-337.pdf` and builds the RAG store.

### 2. Frontend

```bat
cd frontend
npm install
npm run dev
```

Or run `start-frontend.bat`. Open http://127.0.0.1:5173

API docs: http://127.0.0.1:8000/docs

## Source files

| Path | Purpose |
|------|---------|
| `data/source/WAC 246-341.pdf` | Behavioral health agency licensing |
| `data/source/WAC 246-337.pdf` | Residential treatment facility |
| `data/examples/Example 1-5.docx` | Sample investigative reports (style / themes) |

## Investigation workflow

1. **Intake** — paste complaint, set case/facility fields, select authorized WACs  
2. **Compare** — review matched PDF subsections, complaint excerpts, allegation drafts  
3. **Report** — edit IR template (regulatory framework, allegations, 5 evidentiary examples) and export  

Allegation duties are derived **only** from ingested WAC PDF text. Example DOCX files guide intake voice and themes, not subsection applicability.

## Architecture

- **FastAPI** async API + JWT sessions  
- **PyMuPDF** / **python-docx** document parsing  
- **ChromaDB** hierarchical metadata store  
- **TF-IDF** local subsection ranking + regulatory cue scoring  
- **React + Vite + Tailwind** UI  
