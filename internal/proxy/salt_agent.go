package proxy

import (
	"encoding/hex"
	"encoding/json"
	"unicode/utf8"
)

const (
	// MainGameHost 主游戏域名（seq/ack/resp 改写仅对此域名）
	MainGameHost = "xxz-xyzw.hortorgames.com"
	// SaltAgentHost 盐场 Agent WebSocket 域名（仅观测、不改包）
	SaltAgentHost = "xxz-xyzw-new.hortorgames.com"

	saltHexMaxBytes     = 256
	saltUTF8MaxRunes    = 1000
	rawCmdSaltAgentRaw  = "__SALT_AGENT_RAW__"
)

// SaltAgentRawOuter 与前端 JSON.parse(message.msg) 对齐的兜底结构
type SaltAgentRawOuter struct {
	Cmd  string           `json:"cmd"`
	Body SaltAgentRawBody `json:"body"`
}

// SaltAgentRawBody 盐场 raw 兜底 body
type SaltAgentRawBody struct {
	Host        string `json:"host"`
	Path        string `json:"path"`
	Direction   string `json:"direction"` // "client" | "server"
	ByteLength  int    `json:"byteLength"`
	HexPreview  string `json:"hexPreview"`
	UTF8Preview string `json:"utf8Preview"`
	DecodeError string `json:"decodeError"`
}

// BuildSaltAgentRawJSON 返回合法 JSON 字符串，供前端 JSON.parse
func BuildSaltAgentRawJSON(host, path, direction string, raw []byte, decodeError string) string {
	n := len(raw)
	hexLen := saltHexMaxBytes
	if n < hexLen {
		hexLen = n
	}
	hexPreview := hex.EncodeToString(raw[:hexLen])

	utf8Prev := utf8PreviewRunes(raw, saltUTF8MaxRunes)

	outer := SaltAgentRawOuter{
		Cmd: rawCmdSaltAgentRaw,
		Body: SaltAgentRawBody{
			Host:        host,
			Path:        path,
			Direction:   direction,
			ByteLength:  n,
			HexPreview:  hexPreview,
			UTF8Preview: utf8Prev,
			DecodeError: decodeError,
		},
	}
	out, err := json.Marshal(outer)
	if err != nil {
		// 理论上永不失败；兜底仍返回最小合法 JSON
		fallback, _ := json.Marshal(map[string]string{
			"cmd": rawCmdSaltAgentRaw,
			"err": err.Error(),
		})
		return string(fallback)
	}
	return string(out)
}

func utf8PreviewRunes(b []byte, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	s := string(b)
	if utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	rs := []rune(s)
	return string(rs[:maxRunes])
}
