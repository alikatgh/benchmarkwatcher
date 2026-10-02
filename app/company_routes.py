"""Authenticated company search, immutable reports, exports and follow-ups."""
import csv
import io
import json
import re
import secrets
import time

from flask import abort, current_app, flash, g, jsonify, redirect, render_template, request, session, url_for, Response

from app.company_answers import local_answer, provider_answer
from app.company_financials import build_company_report, calculate_company, display_value
from app.extensions import limiter
from app.sec_client import SECError, search_companies
from app.workspace_store import db, read_key, reserve_analysis


def report_record(report_id):
    row = db().execute('SELECT * FROM company_reports WHERE id=? AND user_id=?', (report_id,g.workspace_user['id'])).fetchone()
    if row is None: abort(404)
    return row, json.loads(row['data'])


def company_page(**values):
    from app.workspace_routes import connections
    return render_template('company_workspace.html', user=g.workspace_user, csrf=session['csrf'],
                           connections=connections(), display_value=display_value, **values)


def company_home():
    query = request.args.get('q','').strip()[:100]
    matches, stale, error = [], False, None
    if query:
        try: matches, stale = search_companies(query)
        except SECError as exc: error = str(exc)
    saved = db().execute('SELECT id,title,cik,created_at FROM company_reports WHERE user_id=? ORDER BY created_at DESC LIMIT 40', (g.workspace_user['id'],)).fetchall()
    legacy = db().execute('SELECT id,title FROM analyses WHERE user_id=? ORDER BY created_at DESC LIMIT 10', (g.workspace_user['id'],)).fetchall()
    return company_page(mode='company_home', query=query, matches=matches, stale=stale, error=error, saved=saved, legacy=legacy)


def register_company_routes(bp):
    @bp.get('/companies/search')
    @limiter.limit('60 per minute')
    def company_search():
        try:
            matches, stale = search_companies(request.args.get('q','')[:100])
            return jsonify(companies=matches, stale=stale)
        except SECError as exc: return jsonify(error=str(exc)), 503

    @bp.post('/companies/open')
    @limiter.limit('6 per minute')
    def company_open():
        cik = request.form.get('cik','')
        if not re.fullmatch(r'\d{10}',cik): abort(400)
        count = db().execute('SELECT COUNT(*) FROM company_reports WHERE user_id=? AND created_at>?',
                             (g.workspace_user['id'], int(time.time())-86400)).fetchone()[0]
        if count >= 30:
            if request.headers.get('Accept') == 'application/json': return jsonify(error='You have reached the daily limit of 30 new report snapshots. Your saved reports remain available.'),429
            flash('Daily report limit reached. Open a saved report or try again tomorrow.','error')
            return redirect(url_for('workspace.home'))
        try:
            report = build_company_report(cik)
            report_id = secrets.token_urlsafe(18)
            with db():
                db().execute('INSERT OR IGNORE INTO company_reports VALUES (?,?,?,?,?,?,?)',
                    (report_id,g.workspace_user['id'],cik,report['version'],report['company'],json.dumps(report,allow_nan=False),int(time.time())))
            record = db().execute('SELECT id FROM company_reports WHERE user_id=? AND cik=? AND version=?',
                                  (g.workspace_user['id'],cik,report['version'])).fetchone()
            location = url_for('workspace.company_report',report_id=record['id'])
            if request.headers.get('Accept') == 'application/json': return jsonify(url=location)
            return redirect(location)
        except SECError as exc:
            if request.headers.get('Accept') == 'application/json': return jsonify(error=str(exc)), 503
            flash(str(exc),'error'); return redirect(url_for('workspace.home'))

    @bp.get('/companies/reports/<report_id>')
    def company_report(report_id):
        record, report = report_record(report_id)
        messages = db().execute('SELECT * FROM company_messages WHERE user_id=? AND report_id=? ORDER BY rowid DESC LIMIT 20',
                                 (g.workspace_user['id'],report_id)).fetchall()
        history = [dict(m,result=json.loads(m['result'])) for m in reversed(messages)]
        annual = sorted((p for p in report['periods'] if p['frequency']=='annual'), key=lambda p:p['end'])
        latest = annual[-1]
        metrics = {m['id']:m for m in report['metrics']}
        highlights = [metrics[k] for k in ('revenue','net_interest','premiums','operating_income','net_income','free_cash','operating_cash') if k in metrics and latest['id'] in metrics[k]['values']][:4]
        return company_page(mode='company_report',record=record,report=report,history=history,latest=latest,highlights=highlights)

    @bp.post('/companies/reports/<report_id>/ask')
    @limiter.limit('10 per minute')
    def company_ask(report_id):
        from app.workspace_routes import connections
        _, report = report_record(report_id)
        question = request.form.get('question','').strip()
        if not 2 <= len(question) <= 1500: return jsonify(error='Enter a question between 2 and 1,500 characters.'), 422
        previous = None
        if request.form.get('previous'):
            row = db().execute('SELECT result FROM company_messages WHERE id=? AND user_id=? AND report_id=?',
                (request.form['previous'],g.workspace_user['id'],report_id)).fetchone()
            if row is None: return jsonify(error='The previous answer is unavailable. Start a new topic.'),422
            previous = json.loads(row['result']).get('metric_id')
        provider = 'local'
        try:
            selected = request.form.get('provider','local')
            if selected == 'local': result = local_answer(report,question,previous)
            else:
                parts = selected.split(':',1)
                if len(parts)!=2: raise ValueError('Choose an available provider.')
                provider, model = parts
                connected = next((c for c in connections() if c['provider']==provider),None)
                if not connected or model not in connected['models']: raise ValueError('Connect this provider in AI settings first.')
                if request.form.get('consent')!='yes': raise ValueError('Confirm sharing this question and report evidence with your selected provider.')
                key = read_key(g.workspace_user['id'],provider)
                reserve_analysis(g.workspace_user['id'])
                result = provider_answer(report,question,provider,key,model,previous)
            message_id = secrets.token_urlsafe(18)
            with db():
                db().execute('INSERT INTO company_messages VALUES (?,?,?,?,?,?,?)',
                    (message_id,report_id,g.workspace_user['id'],question,json.dumps(result,allow_nan=False),provider,int(time.time())))
            message = {'id':message_id,'question':question,'result':result,'provider':provider}
            return jsonify(id=message_id,metric=result.get('metric_id'),html=render_template('components/company_exchange.html',message=message,display_value=display_value))
        except ValueError as exc: return jsonify(error=str(exc)),422

    @bp.post('/companies/reports/<report_id>/calculate')
    @limiter.limit('30 per minute')
    def company_calculate(report_id):
        _, report = report_record(report_id)
        try:
            result = calculate_company(report,request.form.get('metric'),request.form.get('operation'),request.form.get('start'),request.form.get('end'),request.form.get('frequency','annual'))
            return jsonify(result=result)
        except ValueError as exc: return jsonify(error=str(exc)),422

    @bp.get('/companies/reports/<report_id>/export.csv')
    @limiter.limit('15 per minute')
    def company_export(report_id):
        _, report = report_record(report_id)
        out = io.StringIO(); writer = csv.writer(out)
        writer.writerow(['Company','Metric','Fiscal period','Start','End','Unit','Value','Method','Filing sources'])
        def safe(value):
            text = str(value)
            return "'"+text if text.startswith(('=','+','-','@','\t','\r')) else text
        for m in report['metrics']:
            for p in report['periods']:
                value = m['values'].get(p['id'])
                if value:
                    writer.writerow([safe(report['company']),safe(m['label']),p['label'],value['start'] or '',value['end'],m['unit'],value['value'],safe(value['method']),' | '.join(s['url'] for s in value['sources'])])
        return Response(out.getvalue(),mimetype='text/csv',headers={'Content-Disposition':f'attachment; filename="company-{report["cik"]}-financials.csv"'})
