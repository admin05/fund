# Fund Income Bark

本脚本用于在本地 NAS / Arcadia 定时计算基金收益，并通过 Bark 推送。

## 使用

1. 复制配置：

```bash
cp config.example.json config.json
```

2. 修改 `config.json`：

- `bark.key`：Bark App 里的 key，例如 `https://api.day.app/xxxxxx` 中的 `xxxxxx`
- `funds[].transactions`：填支付宝基金交易记录

3. 本地测试：

```bash
npm run check
```

4. 正式推送：

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
