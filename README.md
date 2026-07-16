# BUET E-Council

BUET E-Council is a comprehensive, microservices-based web application designed to manage and streamline academic and syndicate council meetings for the Bangladesh University of Engineering and Technology (BUET). 

It offers role-based access control, rich-text agenda and resolution creation, dynamic generation of PDF documents with robust Bengali language support, and a secure user-session architecture.

## Features

- **Meeting Lifecycle Management**: Create, schedule, and lock meetings (Academic, Syndicate).
- **Agenda & Resolutions**: Real-time rich text editor (TipTap) for drafting meeting agendas and resolutions.
- **Automated Document Generation**: Headless Chrome (Puppeteer) driven professional PDF generation, preserving Bengali typography (Sonar Bangla).
- **User & Role Management**: Multi-tier access control (Admin, Moderator, Member) with secure, session-based authentication.
- **Search**: Keyword, entity (department/office/member), and semantic (LaBSE) search over agenda/resolution content in both Bangla and English, with tag and date-range filters and cached results.
- **Object Storage**: Integrated with MinIO (S3 compatible) for storing annexures and generated PDFs.

## Tech Stack

- **Frontend**: Next.js 15 (React 19), Tailwind CSS v4, TipTap, SWR
- **Auth Service**: Node.js, Express.js, bcrypt, JWT-style HTTP-Only Cookies
- **Meeting Service**: Node.js, Express.js, Puppeteer Core, AWS SDK
- **Embedding Service**: Python, FastAPI, `sentence-transformers/LaBSE`
- **Database**: PostgreSQL with `pgvector` extension
- **Storage**: MinIO (S3 API compatible)
- **Proxy**: Nginx Reverse Proxy
- **Containerization**: Docker & Docker Compose

## Quick Start (Docker)

The easiest way to run the entire system locally is by using Docker Compose.

1. **Clone the repository** and navigate to the project directory.

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and fill out any necessary variables. The defaults in `.env.example` will work for local development out of the box.
   ```bash
   cp .env.example .env
   ```

3. **Start the application**:
   ```bash
   docker-compose up -d --build
   ```
   *Note: On the first run, the database initialization (`db/init.sql`) and bucket creation (`createbuckets` service) will automatically configure the schema and MinIO buckets.*

4. **Access the application**:
   - **Frontend**: http://localhost:3000
   - **Backend API Gateway**: http://localhost:9001
   - **MinIO Console**: http://localhost:9090 (Default Login: `minioadmin` / `minioadmin`)

### Default Admin Credentials
When the database is initialized, a default admin account is created:
- **Username**: `admin`
- **Password**: `123456`

## Development Services

| Service | Port | Description |
|---|---|---|
| Frontend | 3000 | Next.js User Interface |
| Auth Service | 8000 | User Management, Session Control |
| Meeting Service | 8001 | Meeting, Agenda, Templates, PDF Generation, Search |
| Embedding Service | 8002 (internal only) | LaBSE embeddings for semantic search |
| Nginx Gateway | 9001 | Reverse proxy to route frontend & API requests |
| MinIO | 9000 | Object storage (S3 API) |
| PostgreSQL DB | 5432 | Relational DB with Vector extension |

## Documentation

For a more comprehensive look at the system architecture, database schemas, and microservice structures, please refer to the [documentation.md](./documentation.md) file.
