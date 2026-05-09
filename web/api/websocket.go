package api

import (
	"encoding/json"
	"github.com/gorilla/websocket"
	"log"
	"net/http"
	"sync"
)

var (
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true // 允许所有跨域请求
		},
	}
	clients   = make(map[*websocket.Conn]bool)
	clientsMu sync.Mutex
)

// WSMessage 定义发送到前端的消息结构
type WSMessage struct {
	Call  string `json:"call"`           // "client" 或 "server"
	Msg   any    `json:"msg"`            // JSON 字符串（内层游戏协议）
	Title string `json:"title,omitempty"` // 例如 【盐场AgentWS】
}

// HandleWebSocket 处理 WebSocket 连接
func HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket 升级错误:", err)
		return
	}
	defer conn.Close()

	// 添加新客户端
	clientsMu.Lock()
	clients[conn] = true
	clientsMu.Unlock()

	// 客户端断开连接时移除
	defer func() {
		clientsMu.Lock()
		delete(clients, conn)
		clientsMu.Unlock()
	}()

	// 保持连接，直到客户端断开
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

// BroadcastMessage 向所有连接的客户端广播消息
func BroadcastMessage(message WSMessage) {
	jsonMessage, err := json.Marshal(message)
	if err != nil {
		log.Println("JSON 编码错误:", err)
		return
	}

	clientsMu.Lock()
	defer clientsMu.Unlock()

	for client := range clients {
		err := client.WriteMessage(websocket.TextMessage, jsonMessage)
		if err != nil {
			log.Println("发送消息错误:", err)
			client.Close()
			delete(clients, client)
		}
	}
}
