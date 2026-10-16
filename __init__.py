aggregate(
  j ~ i,
  data = freq,
  FUN = function(x) c(
    min = min(x),
    max = max(x),
    liczba = length(x)
  )
)
