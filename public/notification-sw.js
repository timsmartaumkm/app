self.addEventListener("push", event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() || "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "SMARTA UMKM", {
      body: data.body || "",
      icon: "/logo_200x200.png",
      badge: "/logo_200x200.png",
      tag: data.tag || "smarta-notification",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      const existing = clients.find(client => client.url.startsWith(self.location.origin) && "focus" in client);
      if (existing) {
        if ("navigate" in existing) return existing.navigate(targetUrl).then(() => existing.focus());
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
