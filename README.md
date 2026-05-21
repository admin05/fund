# Fund Income Bark

本脚本用于在本地 NAS / Arcadia 定时计算基金收益，并通过 Bark 推送。

## 使用

1. 复制配置：

```bash
cp config.example.json config.json
```

2. 修改 `config.json`：

- `funds[].transactions`：填支付宝基金交易记录

3. 在 Arcadia 平台配置环境变量：

```bash
BARK=YOUR_BARK_KEY
```

也可以填完整 Bark URL：

```bash
BARK=https://api.day.app/YOUR_BARK_KEY
```

4. 本地测试：

```bash
npm run check
```

5. 正式推送：

```bash
npm start
```

## 交易记录格式

买入：

```json
{ "type": "buy", "date": "2026-05-20", "amount": 1000, "shares": 363.94, "fee": 0 }
```

卖出：

```json
{ "type": "sell", "date": "2026-05-21", "amount": 500, "shares": 180, "fee": 0 }
```

现金分红：

```json
{ "type": "dividend", "date": "2026-05-21", "amount": 12.34 }
```

红利再投：

```json
{ "type": "reinvest", "date": "2026-05-21", "amount": 12.34, "shares": 4.56 }
```

## 计算口径

- 当日收益 = 当前持有份额 × (最新单位净值 - 上一净值)
- 累计收益 = 当前市值 + 累计卖出到账 + 现金分红 - 累计买入支出
- 累计收益率 = 累计收益 / 累计买入支出

`buy.amount` 建议填写支付宝显示的实际扣款金额；`sell.amount` 建议填写实际到账金额。

## 多笔交易

同一只基金有多笔交易时，按支付宝账单逐笔放进同一个 `transactions` 数组即可：

```json
{
  "code": "013841",
  "alias": "银华集成电路混合C",
  "transactions": [
    { "type": "buy", "date": "2026-05-20", "amount": 1000, "shares": 363.94, "fee": 0 },
    { "type": "buy", "date": "2026-05-21", "amount": 500, "shares": 181.25, "fee": 0 },
    { "type": "sell", "date": "2026-06-10", "amount": 300, "shares": 100, "fee": 0 },
    { "type": "dividend", "date": "2026-06-20", "amount": 12.34 }
  ]
}
```

字段含义：

- `amount`：交易金额。买入时填支付宝实际扣款金额；卖出时填实际到账金额；现金分红时填分红到账金额。
- `shares`：确认份额。买入增加份额，卖出减少份额；在支付宝交易详情里通常叫“确认份额”。
- `fee`：手续费。支付宝大部分 C 类基金申购费为 0；如果交易详情里显示手续费，就照填。
