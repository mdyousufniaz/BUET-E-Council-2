-- Staging tables mirroring the legacy Oracle "ACQ" schema (ACQ.sql), 1:1.
-- Purpose: archive every row from the legacy dump losslessly before transforming
-- the useful parts into the live application schema (see 002_legacy_supporting.sql
-- and the transform script). Types are the closest Postgres equivalents:
--   NUMBER -> NUMERIC, VARCHAR2(n) -> VARCHAR(n), CLOB -> TEXT, DATE -> TIMESTAMP.

CREATE TABLE IF NOT EXISTS legacy_acqconnection (
    val VARCHAR(10)
);

CREATE TABLE IF NOT EXISTS legacy_agendacategories (
    agendaid VARCHAR(20) NOT NULL,
    categoryid NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_agendadepartments (
    agendaid VARCHAR(20),
    departmentid NUMERIC
);

CREATE TABLE IF NOT EXISTS legacy_agendaerrors (
    meetingno NUMERIC,
    agendaid VARCHAR(20),
    name VARCHAR(100),
    email VARCHAR(100),
    inwhere VARCHAR(30),
    description VARCHAR(500),
    edate TIMESTAMP
);

CREATE TABLE IF NOT EXISTS legacy_agendafiles (
    agendaid VARCHAR(20) NOT NULL,
    filename VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_agendalinks (
    agendaid VARCHAR(20),
    linkdata TEXT
);

CREATE TABLE IF NOT EXISTS legacy_agendas (
    agendaid VARCHAR(20) NOT NULL,
    proposal TEXT,
    decision TEXT,
    appendix TEXT,
    nod VARCHAR(10)
);

CREATE TABLE IF NOT EXISTS legacy_agendatables (
    agendaid VARCHAR(20),
    tabledata TEXT
);

CREATE TABLE IF NOT EXISTS legacy_backmembers (
    memberid NUMERIC NOT NULL,
    membername VARCHAR(200),
    designation VARCHAR(200),
    department VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS legacy_categories (
    categoryid NUMERIC NOT NULL,
    categoryname VARCHAR(1000)
);

CREATE TABLE IF NOT EXISTS legacy_categorylevel (
    parentid NUMERIC NOT NULL,
    childid NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_comments (
    name VARCHAR(100),
    email VARCHAR(100),
    comments VARCHAR(500),
    cdate TIMESTAMP
);

CREATE TABLE IF NOT EXISTS legacy_departmentalias (
    departmentid NUMERIC NOT NULL,
    departmentalias VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_departments (
    departmentid NUMERIC NOT NULL,
    departmentname VARCHAR(200),
    rank NUMERIC
);

CREATE TABLE IF NOT EXISTS legacy_meeting (
    meetingno NUMERIC NOT NULL,
    initials VARCHAR(10),
    txtmembers TEXT
);

CREATE TABLE IF NOT EXISTS legacy_meetingagendas (
    meetingno NUMERIC NOT NULL,
    agendaid VARCHAR(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_meetingdates (
    meetingno NUMERIC NOT NULL,
    meetingdate TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_meetingfiles (
    meetingno NUMERIC NOT NULL,
    filename VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS legacy_meetingmembers (
    meetingno NUMERIC NOT NULL,
    memberid NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_meetingusers (
    meetingno NUMERIC NOT NULL,
    supervisorname VARCHAR(100) NOT NULL,
    operatorname VARCHAR(100) NOT NULL,
    ostatus VARCHAR(20),
    sstatus VARCHAR(20),
    lstatus VARCHAR(20),
    astatus VARCHAR(20),
    mstatus VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS legacy_meetingview (
    meetingno NUMERIC NOT NULL,
    viewno VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS legacy_members (
    memberid NUMERIC NOT NULL,
    membername VARCHAR(200),
    designation VARCHAR(200),
    department VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS legacy_printdata (
    agendaid VARCHAR(50),
    proposal VARCHAR(50),
    decision VARCHAR(50),
    appendix VARCHAR(50),
    files VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS legacy_tempac (
    agendaid VARCHAR(20),
    categoryid VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS legacy_tempagendacategories (
    agendaid VARCHAR(20) NOT NULL,
    categoryid NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_tempagendas (
    name VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS legacy_tmpmembers (
    id NUMERIC,
    pos NUMERIC
);

CREATE TABLE IF NOT EXISTS legacy_tmpnames (
    id NUMERIC,
    membername VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS legacy_users (
    username VARCHAR(100) NOT NULL,
    password VARCHAR(100),
    role VARCHAR(30)
);
