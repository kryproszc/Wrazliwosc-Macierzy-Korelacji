s4 <- as.data.frame(sev_data[sev_data$LOB == "LOB_4", ])
u4 <- as.data.frame(udzialy_data[
  udzialy_data$LOB == "LOB_4", ])

s4 <- s4[order(s4$typ), ]

# Sprawdzenie rzeczywistych danych i nazw
names(u4)
print(u4, digits = 15)

# Wybór kolumny z udziałami
kolumna <- intersect(c("udział", "udzial"), names(u4))

stopifnot(
  nrow(s4) == 2,
  nrow(u4) == 2,
  length(kolumna) == 1
)

p <- u4[[kolumna]][match(s4$typ, u4$typ)]

print(p, digits = 15)
print(sum(p), digits = 15)

stopifnot(
  length(p) == 2,
  !anyNA(p),
  abs(sum(p) - 1) < 1e-5
)
