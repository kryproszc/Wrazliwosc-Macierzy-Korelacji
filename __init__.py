diag_w <- aggregate(
  w ~ r + m,
  data = subset(wd, i == 2000),
  FUN = function(x) c(
    liczba = length(x),
    suma = sum(x),
    min = min(x),
    max = max(x)
  )
)

print(head(diag_w, 12))
