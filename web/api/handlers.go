package api

import (
	"encoding/json"
	gamemitm "github.com/husanpao/game-mitm"
	"log"
	"net/http"
	"os"
	"time"
	"xyzw_study/internal/crypto/bon"
	"xyzw_study/internal/model"
	"xyzw_study/internal/proxy"
)

var (
	debugQueue = make(chan DebugMessage, 100) // 调试消息队列
	game       *gamemitm.Session
)

// Notes 定义备注数据结构
type Notes struct {
	CommandNotes map[string]string            `json:"commandNotes"`
	KeyNotes     map[string]map[string]string `json:"keyNotes"`
}

// DebugMessage 定义调试消息结构
type DebugMessage struct {
	Cmd  string `json:"cmd"`
	Data any    `json:"data"`
}

// 保存备注数据到文件
func saveNotes(notes Notes) error {
	data, err := json.MarshalIndent(notes, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(notesFilePath, data, 0644)
}

// 从文件加载备注数据
func loadNotes() (Notes, error) {
	var notes Notes
	notes.CommandNotes = make(map[string]string)
	notes.KeyNotes = make(map[string]map[string]string)

	data, err := os.ReadFile(notesFilePath)
	if err != nil {
		if os.IsNotExist(err) {
			// 文件不存在，返回空备注
			return notes, nil
		}
		return notes, err
	}

	err = json.Unmarshal(data, &notes)
	return notes, err
}

// HandleSaveNotes 处理备注保存请求
func HandleSaveNotes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "只支持POST请求", http.StatusMethodNotAllowed)
		return
	}

	var notes Notes
	err := json.NewDecoder(r.Body).Decode(&notes)
	if err != nil {
		http.Error(w, "解析请求数据失败: "+err.Error(), http.StatusBadRequest)
		return
	}

	err = saveNotes(notes)
	if err != nil {
		http.Error(w, "保存备注失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success": true}`))
}

// HandleLoadNotes 处理备注加载请求
func HandleLoadNotes(w http.ResponseWriter, r *http.Request) {
	notes, err := loadNotes()
	if err != nil {
		http.Error(w, "加载备注失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(notes)
}

// HandleDebugMessage 处理调试消息发送
func HandleDebugOpenGame(w http.ResponseWriter, r *http.Request) {
	proxy.Redirect = true
	w.WriteHeader(http.StatusOK)
	if proxy.AuthData == "" {
		w.Write([]byte(`{"success": false}`))
		return
	}
	w.Write([]byte(`{"success": true}`))
}
func HandleDebugMessage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "只支持POST请求", http.StatusMethodNotAllowed)
		return
	}

	var message DebugMessage
	err := json.NewDecoder(r.Body).Decode(&message)
	if err != nil {
		http.Error(w, "解析请求数据失败: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 将消息添加到队列
	select {
	case debugQueue <- message:
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"success": true}`))
	default:
		http.Error(w, "调试队列已满", http.StatusServiceUnavailable)
	}
}

// ConsumeDebugQueue 消费调试消息队列
func ConsumeDebugQueue() {
	for {
		select {
		case msg := <-debugQueue:
			// 构造消息
			log.Println("收到调试消息:", msg)
			if game != nil {

				debugMsg := model.XYMsg{
					Ack:  0,
					Body: bon.EncodeToBytes(msg.Data),
					Cmd:  msg.Cmd,
					Seq:  proxy.NextSeq(),
					Time: time.Now().UnixMilli(),
				}
				bs, err := bon.EncodeAndEncryptX(debugMsg)
				result := make([]byte, len(bs))
				copy(result, bs)
				if err != nil {
					log.Println(err)
				} else {
					HandleGamePacket(proxy.GamePacket{Raw: bs, RawData: bon.DecodeX(bs), Direction: proxy.Send, Session: nil})
					game.SendBinaryToServer(result)

				}
			}
			// 等待2秒
			time.Sleep(2 * time.Second)
		}
	}
}

// HandleGamePacket 处理游戏数据包
func HandleGamePacket(packet proxy.GamePacket) {
	if packet.Host == proxy.MainGameHost && packet.Session != nil && game == nil {
		game = packet.Session
	}

	// 确定消息方向
	var call string
	if packet.Direction == proxy.Send {
		call = "client"
	} else {
		call = "server"
	}

	title := ""
	if packet.Host == proxy.SaltAgentHost {
		title = "【盐场AgentWS】"
		log.Printf("【盐场AgentWS】 host=%s direction=%s byteLength=%d", packet.Host, call, len(packet.Raw))
	}

	// 广播消息到所有连接的 WebSocket 客户端
	BroadcastMessage(WSMessage{
		Call:  call,
		Msg:   packet.RawData,
		Title: title,
	})
}
