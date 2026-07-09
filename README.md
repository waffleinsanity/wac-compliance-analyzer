# WAC Compliance Analyzer

Self-contained web application for Washington Administrative Code (WAC) **246-341** and **246-337** compliance analysis.

## Features

- Hierarchical PDF ingestion (code → (1) → (a) → (i)) into SQLite + ChromaDB
- Checkbox WAC authorization directory with search, favorites, and expand/collapse chapters
- Local RAG-style analysis (no external LLM APIs) with five output templates
- Auto-generated + user-customizable trigger phrases (JWT auth)
- Example DOCX loading, multi-file upload/batch analysis
- Dark/light/system theme, statistics dashboard, optional official-site validation

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
| `data/examples/Example 1-5.docx` | Sample investigative reports |

## Output templates

1. Full Compliance  
2. Non-Compliance  
3. Partial Compliance  
4. Informational Reference  
5. Insufficient Information  

## Architecture

- **FastAPI** async API + JWT sessions  
- **PyMuPDF** / **python-docx** document parsing  
- **ChromaDB** hierarchical metadata store  
- **TF-IDF** local retrieval + regulatory cue scoring  
- **React + Vite + Tailwind** UI  

Optional validation endpoints hit:

- https://app.leg.wa.gov/WAC/default.aspx?cite=246-341&full=true  
- https://app.leg.wa.gov/WAC/default.aspx?cite=246-337&full=true  
