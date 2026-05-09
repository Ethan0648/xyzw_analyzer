package proxy

import (
	"encoding/hex"
	"encoding/json"
	gamemitm "github.com/husanpao/game-mitm"
	"sync/atomic"
	"xyzw_study/internal/crypto/bon"
)

// Direction 定义数据包方向
type Direction int

const (
	// Send 表示从客户端发送到服务器的数据包
	Send Direction = iota
	// Receive 表示从服务器接收到客户端的数据包
	Receive
)

var Redirect bool
var AuthData string

var seq int32
var clientMSg map[int32]int32

func NextSeq() int32 {
	return atomic.AddInt32(&seq, 1)
}

func CurrentSeq() int32 {
	return atomic.LoadInt32(&seq)
}

// GamePacket 定义游戏数据包结构
type GamePacket struct {
	Raw       []byte
	RawData   any
	Direction Direction // 使用枚举类型标识消息方向
	Session   *gamemitm.Session
	Host      string // MainGameHost / SaltAgentHost；空表示未分类（如调试注入）
}

// PacketHandler 定义处理数据包的函数类型
type PacketHandler func(packet GamePacket)

func saltPathAndHost(ctx *gamemitm.ProxyCtx) (host, path string) {
	host = SaltAgentHost
	path = "/"
	if ctx != nil && ctx.Req != nil && ctx.Req.URL != nil {
		if h := ctx.Req.URL.Hostname(); h != "" {
			host = h
		}
		if ctx.Req.URL.Path != "" {
			path = ctx.Req.URL.Path
		}
	}
	return host, path
}

func saltDirectionLabel(dir Direction) string {
	if dir == Send {
		return "client"
	}
	return "server"
}

// handleSaltAgentHostFrame 盐场：一律 return original，不做 seq/ack/resp 改写；每帧都广播。
func handleSaltAgentHostFrame(handler PacketHandler, body []byte, ctx *gamemitm.ProxyCtx, dir Direction) []byte {
	if handler == nil {
		return body
	}
	original := append([]byte(nil), body...)
	host, path := saltPathAndHost(ctx)
	dirLabel := saltDirectionLabel(dir)

	var decodeErr string
	if len(body) >= 2 && body[0] == 0x70 && body[1] == 0x78 {
		decodedInput := make([]byte, len(body))
		copy(decodedInput, body)
		s := bon.DecodeX(decodedInput)
		if s != "" {
			if json.Valid([]byte(s)) {
				handler(GamePacket{
					Raw:       original,
					RawData:   s,
					Direction: dir,
					Session:   ctx.WSSession,
					Host:      SaltAgentHost,
				})
				return original
			}
			decodeErr = "DecodeX output is not valid JSON"
		} else {
			decodeErr = "DecodeX returned empty or decrypt/decode failed"
		}
	} else {
		if len(body) < 2 {
			decodeErr = "frame shorter than 2 bytes or missing px header"
		} else {
			decodeErr = "non-px frame (missing 0x70 0x78 header)"
		}
	}

	rawJSON := BuildSaltAgentRawJSON(host, path, dirLabel, original, decodeErr)
	handler(GamePacket{
		Raw:       original,
		RawData:   rawJSON,
		Direction: dir,
		Session:   ctx.WSSession,
		Host:      SaltAgentHost,
	})
	return original
}

// StartCapture 开始捕获游戏数据包
func StartCapture(handler PacketHandler) {
	proxy := gamemitm.NewProxy()
	proxy.SetVerbose(false)
	seq = 0
	clientMSg = make(map[int32]int32)

	// ---------- 主游戏：逻辑与原实现一致，仅补充 Host ----------
	proxy.OnRequest(MainGameHost).Do(func(body []byte, ctx *gamemitm.ProxyCtx) []byte {
		if handler == nil {
			return body
		}
		if ctx.Req.URL.Path == "/login/authuser" {
			if Redirect && AuthData != "" {
				bs, _ := hex.DecodeString(AuthData)
				Redirect = false
				return bs
			}
			AuthData = hex.EncodeToString(body)
			return body
		}

		original := make([]byte, len(body))
		copy(original, body)
		if len(body) >= 2 && body[0] == 0x70 && body[1] == 0x78 {
			msg := bon.DecodeXAsMap(body)
			if msg["seq"] != nil {
				gameSeq := msg["seq"].(int32)
				if gameSeq == 1 {
					seq = 0
				}
			}

			var processed []byte
			if msg["cmd"] == nil {
				return original
			}
			if msg["cmd"].(string) == "_sys/ack" {
				processed = bon.EncodeReplaceAck(original, seq+1)
			} else {
				processed = bon.EncodeReplaceSeq(original, NextSeq())
				clientMSg[CurrentSeq()] = msg["seq"].(int32)
			}
			decodedInput := make([]byte, len(processed))
			copy(decodedInput, processed)
			updateStr := bon.DecodeX(decodedInput)
			handler(GamePacket{processed, updateStr, Send, ctx.WSSession, MainGameHost})
			return processed
		}
		return original
	})
	proxy.OnResponse(MainGameHost).Do(func(body []byte, ctx *gamemitm.ProxyCtx) []byte {
		if handler == nil {
			return body
		}
		original := make([]byte, len(body))
		copy(original, body)
		if len(body) >= 2 && body[0] == 0x70 && body[1] == 0x78 {

			msg := bon.DecodeXAsMap(body)
			var processed []byte
			if msg["cmd"] == nil {
				return original
			}
			if msg["cmd"].(string) == "_sys/ack" {
				processed = bon.EncodeReplaceAck(original, CurrentSeq())
			} else {
				if msg["resp"] != nil {
					if rseq, ok := clientMSg[msg["resp"].(int32)]; ok {
						processed = bon.EncodeReplaceResp(original, rseq)
					} else {
						processed = original
					}
				} else {
					processed = original
				}

			}
			decodedInput := make([]byte, len(processed))
			copy(decodedInput, processed)
			updateStr := bon.DecodeX(decodedInput)
			handler(GamePacket{processed, updateStr, Receive, ctx.WSSession, MainGameHost})
			return processed
		}
		return original
	})

	// ---------- 盐场 Agent：完整 MITM WSS 帧回调；只观测、不改写；每帧必广播 ----------
	proxy.OnRequest(SaltAgentHost).Do(func(body []byte, ctx *gamemitm.ProxyCtx) []byte {
		return handleSaltAgentHostFrame(handler, body, ctx, Send)
	})
	proxy.OnResponse(SaltAgentHost).Do(func(body []byte, ctx *gamemitm.ProxyCtx) []byte {
		return handleSaltAgentHostFrame(handler, body, ctx, Receive)
	})

	proxy.Start()
}
