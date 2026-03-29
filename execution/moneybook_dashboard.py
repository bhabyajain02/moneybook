"""
MoneyBook — Streamlit Dashboard
=================================
Visual financial dashboard for a retail store owner.
Shows: KPIs, daily sales trend, expense breakdown, udhaar list, transaction log.

Run:
    streamlit run execution/moneybook_dashboard.py
"""

import os
import sys
import sqlite3
from datetime import date, timedelta

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, os.path.dirname(__file__))

from moneybook_db import DB_PATH, get_all_active_stores

# ─────────────────────────────────────────────
# Page config
# ─────────────────────────────────────────────
st.set_page_config(
    page_title='MoneyBook',
    page_icon='📒',
    layout='wide',
    initial_sidebar_state='expanded',
)

# ─────────────────────────────────────────────
# DB helpers (read-only for dashboard)
# ─────────────────────────────────────────────

@st.cache_resource
def db_conn():
    """Cached SQLite connection (read-only for dashboard)."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def load_stores() -> pd.DataFrame:
    return pd.read_sql(
        "SELECT * FROM stores WHERE onboarding_state = 'active'",
        db_conn()
    )


def load_transactions(store_id: int, start: str, end: str) -> pd.DataFrame:
    return pd.read_sql(
        """SELECT * FROM transactions
           WHERE store_id = ? AND date BETWEEN ? AND ?
           ORDER BY date DESC, created_at DESC""",
        db_conn(), params=[store_id, start, end]
    )


def load_udhaar(store_id: int) -> pd.DataFrame:
    return pd.read_sql(
        "SELECT * FROM udhaar WHERE store_id = ? ORDER BY balance DESC",
        db_conn(), params=[store_id]
    )


def load_daily_totals(store_id: int, start: str, end: str) -> pd.DataFrame:
    return pd.read_sql(
        """SELECT date, type, SUM(amount) AS total
           FROM transactions
           WHERE store_id = ? AND date BETWEEN ? AND ?
           GROUP BY date, type""",
        db_conn(), params=[store_id, start, end]
    )


# ─────────────────────────────────────────────
# Header
# ─────────────────────────────────────────────
st.title('📒 MoneyBook')
st.caption('Smart digital khata for retail stores')

# ─────────────────────────────────────────────
# Sidebar
# ─────────────────────────────────────────────
with st.sidebar:
    st.header('🏪 Store')

    stores_df = load_stores()

    if stores_df.empty:
        st.warning('No stores yet. Send a WhatsApp message to register!')
        st.stop()

    store_name = st.selectbox('Select store', stores_df['name'].tolist())
    store_row  = stores_df[stores_df['name'] == store_name].iloc[0]
    store_id   = int(store_row['id'])

    st.divider()
    st.header('📅 Date Range')
    end_dt   = st.date_input('To',   date.today())
    start_dt = st.date_input('From', date.today() - timedelta(days=6))

    if start_dt > end_dt:
        st.error('Start must be before end date.')
        st.stop()

    st.divider()
    st.caption(f"📞 {store_row['phone']}")
    st.caption(f"🗓️ Since {str(store_row['created_at'])[:10]}")

start_str = start_dt.isoformat()
end_str   = end_dt.isoformat()

# ─────────────────────────────────────────────
# Load data
# ─────────────────────────────────────────────
txns_df    = load_transactions(store_id, start_str, end_str)
udhaar_df  = load_udhaar(store_id)
daily_df   = load_daily_totals(store_id, start_str, end_str)

# ─────────────────────────────────────────────
# KPI row
# ─────────────────────────────────────────────
def sum_type(df: pd.DataFrame, t: str) -> float:
    return float(df[df['type'] == t]['amount'].sum()) if not df.empty else 0.0

total_sales    = sum_type(txns_df, 'sale')
total_expenses = sum_type(txns_df, 'expense')
net_pl         = total_sales - total_expenses
udhaar_out     = float(udhaar_df[udhaar_df['balance'] > 0]['balance'].sum()) if not udhaar_df.empty else 0.0

c1, c2, c3, c4 = st.columns(4)
c1.metric('💰 Total Sales',         f'₹{total_sales:,.0f}')
c2.metric('💸 Total Expenses',      f'₹{total_expenses:,.0f}')
c3.metric('📊 Net P&L',             f'₹{net_pl:,.0f}',
          delta=f'₹{net_pl:,.0f}', delta_color='normal')
c4.metric('⚠️ Outstanding Udhaar',  f'₹{udhaar_out:,.0f}',
          delta_color='inverse')

st.divider()

# ─────────────────────────────────────────────
# Charts row
# ─────────────────────────────────────────────
col_l, col_r = st.columns([2, 1])

with col_l:
    st.subheader('📈 Daily Sales Trend')
    if not daily_df.empty:
        sales_daily = daily_df[daily_df['type'] == 'sale'][['date', 'total']].copy()
        if not sales_daily.empty:
            fig = px.bar(
                sales_daily, x='date', y='total',
                labels={'total': 'Sales (₹)', 'date': 'Date'},
                color_discrete_sequence=['#4CAF50'],
            )
            fig.update_layout(
                plot_bgcolor='rgba(0,0,0,0)',
                yaxis=dict(tickprefix='₹'),
                showlegend=False,
            )
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info('No sales recorded in this period.')
    else:
        st.info('No data yet.')

with col_r:
    st.subheader('💳 Expense Breakdown')
    if not txns_df.empty:
        exp_df = txns_df[txns_df['type'] == 'expense'].copy()
        if not exp_df.empty:
            exp_grouped = exp_df.groupby('description')['amount'].sum().reset_index()
            fig = px.pie(
                exp_grouped,
                values='amount', names='description',
                color_discrete_sequence=px.colors.qualitative.Pastel,
            )
            fig.update_traces(textinfo='percent+label')
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info('No expenses in this period.')

st.divider()

# ─────────────────────────────────────────────
# Cash flow waterfall
# ─────────────────────────────────────────────
st.subheader('🌊 Cash Flow Overview')

cash_in  = total_sales + sum_type(txns_df, 'udhaar_received') + sum_type(txns_df, 'opening_balance')
cash_out = total_expenses + sum_type(txns_df, 'udhaar_given') + sum_type(txns_df, 'bank_deposit')

fig_wf = go.Figure(go.Waterfall(
    name='Cash Flow',
    orientation='v',
    measure=['relative', 'relative', 'relative', 'relative', 'total'],
    x=['Sales', 'Udhaar Recv', 'Expenses', 'Udhaar Given', 'Net'],
    y=[
        total_sales,
        sum_type(txns_df, 'udhaar_received'),
        -total_expenses,
        -sum_type(txns_df, 'udhaar_given'),
        0,
    ],
    connector={'line': {'color': 'rgb(63, 63, 63)'}},
    increasing={'marker': {'color': '#4CAF50'}},
    decreasing={'marker': {'color': '#F44336'}},
    totals={'marker': {'color': '#2196F3'}},
))
fig_wf.update_layout(
    yaxis=dict(tickprefix='₹'),
    plot_bgcolor='rgba(0,0,0,0)',
    showlegend=False,
    height=300,
)
st.plotly_chart(fig_wf, use_container_width=True)

st.divider()

# ─────────────────────────────────────────────
# Udhaar + Transactions
# ─────────────────────────────────────────────
col_u, col_t = st.columns([1, 2])

with col_u:
    st.subheader('⚠️ Outstanding Udhaar')
    outstanding = udhaar_df[udhaar_df['balance'] > 0].copy()
    if not outstanding.empty:
        outstanding = outstanding[['person_name', 'balance', 'last_transaction_date']].copy()
        outstanding.columns = ['Person', 'Amount (₹)', 'Last Activity']
        outstanding['Amount (₹)'] = outstanding['Amount (₹)'].apply(lambda x: f'₹{x:,.0f}')
        st.dataframe(outstanding, use_container_width=True, hide_index=True)

        # Udhaar bar chart
        fig_ud = px.bar(
            udhaar_df[udhaar_df['balance'] > 0],
            x='person_name', y='balance',
            labels={'balance': 'Amount (₹)', 'person_name': 'Person'},
            color_discrete_sequence=['#FF9800'],
        )
        fig_ud.update_layout(
            plot_bgcolor='rgba(0,0,0,0)',
            yaxis=dict(tickprefix='₹'),
            showlegend=False,
            height=250,
        )
        st.plotly_chart(fig_ud, use_container_width=True)
    else:
        st.success('✅ No outstanding udhaar!')

with col_t:
    st.subheader('📋 Transaction Log')
    if not txns_df.empty:
        display = txns_df[['date', 'type', 'amount', 'description', 'person_name', 'payment_mode', 'source']].copy()
        display.columns = ['Date', 'Type', 'Amount', 'Description', 'Person', 'Mode', 'Source']
        display['Amount'] = display['Amount'].apply(lambda x: f'₹{x:,.0f}')

        # Type filter
        types = ['All'] + sorted(display['Type'].unique().tolist())
        sel_type = st.selectbox('Filter by type', types)
        if sel_type != 'All':
            display = display[display['Type'] == sel_type]

        st.dataframe(display.head(50), use_container_width=True, hide_index=True)
    else:
        st.info('No transactions in selected period.')

# ─────────────────────────────────────────────
# Footer
# ─────────────────────────────────────────────
st.divider()
st.caption(
    f'Store: **{store_name}** | '
    f'Range: {start_str} → {end_str} | '
    f'Transactions: {len(txns_df)} | '
    f'Last refreshed: {date.today()}'
)
