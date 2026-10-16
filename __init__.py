for (rok in 2000:2024) {

  sev_rok <- subset(sev, i == rok)

  cat(
    "Rok:", rok,
    "| Liczba rekordów:", nrow(sev_rok),
    "| Typy:", paste(sev_rok$r, collapse = ","),
    "\n"
  )
}
