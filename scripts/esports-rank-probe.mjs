import axios from 'axios'
import fs from 'node:fs/promises'

const url = 'https://esports-data.5eplaycdn.com/v1/api/csgo/new/rank/team_list'
const cases = [
    ['nested-page', { page: { page: 2, page_size: 50, size: 50, limit: 50, current: 2 } }],
    ['nested-pagination', { pagination: { page: 2, page_size: 50, size: 50, limit: 50 } }],
    ['nested-paging', { paging: { page: 2, page_size: 50, size: 50 } }],
    ['query-all', {}, { page:2, limit:50, size:50, pagesize:50, page_size:50, pager:2, current:2, num:2, page_num:2, page_no:2, current_page:2 }],
    ['body-all', { page:2, limit:50, size:50, pagesize:50, page_size:50, pager:2, current:2, num:2, page_num:2, page_no:2, current_page:2, Page:2, PageSize:50, next_page:2 }],
    ['vrs-all', { limit:500, page_size:500, size:500, pagesize:500, count:500 }]
].map(([name, body, params]) => [name, { sort_key: 'valve_point', sort_value: 'desc', ...body }, params])
const results = await Promise.allSettled(cases.map(async ([name, body, params]) => {
    const response = await axios.post(url, body, { timeout: 15000, params })
    const data = response.data
    await fs.writeFile(`preview/esports/rank-probe-${name}.json`, JSON.stringify(data, null, 2))
    return { name, success: data.success, total: data.data?.total_rows, pages: data.data?.total_page,
        count: data.data?.items?.length, rows: data.data?.items?.slice(0, 5).map(t => [t.team_name, t.field_values?.valve_rank, t.field_values?.valve_point, t.field_values?.region_name]) }
}))
for (const result of results) console.log(result.status === 'fulfilled' ? result.value : result.reason.message)
